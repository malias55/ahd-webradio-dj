import { randomUUID } from "node:crypto";
import { get as httpGet, type IncomingMessage } from "node:http";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

// All built-in station, bulletin and live-relay outputs are MPEG-1 Layer III,
// 44.1 kHz stereo. Route whole frames without another lossy music encode.
const BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
export const MP3_FRAME_MS = 1152 / 44.1;
export class Mp3Frames {
  private pending = Buffer.alloc(0);
  push(chunk: Buffer): Buffer[] {
    this.pending = Buffer.concat([this.pending, chunk]);
    if (this.pending.length > 1024 * 1024) throw new Error("MP3 input exceeded parser limit");
    const frames: Buffer[] = [];
    let offset = 0;
    while (this.pending.length - offset >= 4) {
      // Live relays may include an ID3 header; never inject tags between frames.
      if (this.pending.toString("ascii", offset, offset + 3) === "ID3") {
        if (this.pending.length - offset < 10) break;
        const size = 10 + ((this.pending[offset + 6] & 127) * 2097152) + ((this.pending[offset + 7] & 127) * 16384) + ((this.pending[offset + 8] & 127) * 128) + (this.pending[offset + 9] & 127) + ((this.pending[offset + 5] & 16) ? 10 : 0);
        if (size > 1024 * 1024) throw new Error("MP3 metadata exceeded parser limit");
        if (this.pending.length - offset < size) break;
        offset += size;
        continue;
      }
      const header = this.pending.readUInt32BE(offset);
      const bitrate = BITRATES[(header >>> 12) & 15];
      const valid = (header >>> 21) === 2047 && ((header >>> 19) & 3) === 3 && ((header >>> 17) & 3) === 1 && ((header >>> 10) & 3) === 0 && ((header >>> 6) & 3) !== 3 && bitrate;
      if (!valid) { offset++; continue; }
      const size = Math.floor(144000 * bitrate / 44100) + ((header >>> 9) & 1);
      if (this.pending.length - offset < size) break;
      frames.push(Buffer.from(this.pending.subarray(offset, offset + size)));
      offset += size;
    }
    this.pending = this.pending.subarray(offset);
    return frames;
  }
}

export type SourceOpener = (urls: string[], data: (chunk: Buffer) => void, ended: () => void) => () => void;

// Only the server's own MP3 routes are accepted, never arbitrary client URLs.
export const openSpeakerSource: SourceOpener = (urls, data, ended) => {
  if (urls.length === 1) {
    let response: IncomingMessage | undefined;
    let closed = false;
    const finish = () => { if (!closed) { closed = true; response?.destroy(); request.destroy(); ended(); } };
    const request = httpGet(urls[0], { agent: false }, res => {
      response = res;
      if (res.statusCode !== 200) { finish(); return; }
      res.on("data", data);
      res.once("end", finish);
      res.once("error", finish);
      res.once("aborted", finish);
    });
    request.setTimeout(10_000, finish);
    request.once("error", finish);
    return () => { closed = true; response?.destroy(); request.destroy(); };
  }
  // Preserve simultaneous announcements. Only this uncommon case is mixed;
  // ordinary music/news passes through byte-for-byte without re-encoding.
  const proc: ChildProcessWithoutNullStreams = spawn(process.env.FFMPEG_PATH || "ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-nostdin",
    ...urls.flatMap(url => ["-rw_timeout", "10000000", "-probesize", "8192", "-analyzeduration", "0", "-i", url]),
    "-filter_complex", `${urls.map((_, index) => `[${index}:a]`).join("")}amix=inputs=${urls.length}:duration=longest:dropout_transition=0:normalize=0,alimiter=level=false[out]`,
    "-map", "[out]", "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "128k",
    "-id3v2_version", "0", "-write_xing", "0", "-flush_packets", "1", "-f", "mp3", "pipe:1",
  ], { stdio: ["pipe", "pipe", "pipe"] });
  let closed = false;
  const finish = () => { if (!closed) { closed = true; ended(); } };
  proc.stdout.on("data", data);
  proc.stderr.resume();
  proc.once("error", finish);
  proc.once("close", finish);
  return () => { closed = true; proc.kill("SIGKILL"); };
};

type Sink = {
  readonly destroyed: boolean;
  write(chunk: Buffer): boolean;
  end(): unknown;
  destroy?(): unknown;
  once(event: "close" | "drain", listener: () => void): unknown;
};
export class SpeakerStream {
  private clients = new Map<Sink, { blocked: boolean; pending: Buffer[]; listener?: string; connection: string; firstFrame: number }>();
  private frameNumber = 0;
  private reconnects = 0;
  private slowDisconnects = 0;
  private underruns = 0;
  private frames: Buffer[] = [];
  private primed = false;
  private urls: string[] = [];
  private selection = "";
  private stopInput?: () => void;
  private revision = 0;
  private closed = false;
  private retryAt = 0;
  private lastInputAt = 0;
  private received = false;
  private silenceIndex = 0;
  private nextFrameAt = performance.now();
  private tickTimer?: ReturnType<typeof setTimeout>;
  private pollTimer?: ReturnType<typeof setTimeout>;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private failures = 0;

  constructor(
    private readonly readSources: () => Promise<string[] | null>,
    private readonly silence: Buffer[],
    private readonly onIdle: () => void,
    private readonly open: SourceOpener = openSpeakerSource,
  ) {
    if (!silence.length) throw new Error("Speaker silence is missing");
  }

  attach(res: Sink, listener?: string) {
    if (this.closed) throw new Error("Speaker stream is closed");
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    this.clients.set(res, { blocked: false, pending: [], listener, connection: randomUUID(), firstFrame: this.frameNumber });
    res.once("close", () => {
      this.detach(res);
    });
    if (!this.tickTimer) { this.nextFrameAt = performance.now(); this.tick(); void this.poll(); }
  }

  private detach(client: Sink) {
    this.clients.delete(client);
    if (!this.clients.size && !this.closed && !this.idleTimer) this.idleTimer = setTimeout(() => { this.close(); this.onIdle(); }, 5000);
  }

  private connect(urls: string[]) {
    this.stopInput?.(); this.stopInput = undefined;
    this.frames = []; this.primed = false;
    const revision = ++this.revision;
    this.reconnects++;
    this.urls = urls; this.received = false;
    if (!urls.length || this.closed) return;
    const parser = new Mp3Frames();
    this.lastInputAt = Date.now();
    const ended = () => {
      if (this.closed || revision !== this.revision) return;
      this.revision++;
      this.stopInput?.(); this.stopInput = undefined;
      this.retryAt = Date.now() + Math.min(10_000, 1000 * 2 ** Math.min(this.failures++, 3));
    };
    this.stopInput = this.open(urls, chunk => {
      if (this.closed || revision !== this.revision) return;
      try {
        const frames = parser.push(chunk);
        if (frames.length) { this.lastInputAt = Date.now(); this.failures = 0; this.received = true; }
        this.frames.push(...frames);
        // Bound latency and memory even if an upstream stops pacing its output.
        // Six seconds also accommodates the live relay's four-second preamble.
        if (this.frames.length > 230) this.frames.splice(0, this.frames.length - 230);
      } catch { ended(); }
    }, ended);
  }

  private async poll() {
    if (this.closed) return;
    try {
      const urls = await this.readSources();
      if (this.closed) return;
      // A transient DB/status failure must not interrupt a healthy source.
      if (urls !== null) {
        const selection = JSON.stringify(urls);
        if (selection !== this.selection) {
          this.selection = selection; this.failures = 0; this.retryAt = 0;
          this.connect(urls);
        }
      }
      if (this.urls.length && ((!this.stopInput && Date.now() >= this.retryAt) || (this.stopInput && Date.now() - this.lastInputAt > 12_000))) this.connect(this.urls);
    } catch { /* Keep the connection and retry; the clock supplies silence if needed. */ }
    if (!this.closed) this.pollTimer = setTimeout(() => { void this.poll(); }, 250);
  }

  private tick() {
    if (this.closed) return;
    // A small server-side jitter buffer absorbs upstream FFmpeg bursts. Do not
    // alternate silence and reservoir-dependent MP3 frames on every input gap.
    if (!this.primed && this.frames.length >= 12) this.primed = true;
    // A small scheduling/input hiccup is not a programme gap. Inserting MP3
    // silence here breaks reservoir continuity and creates periodic dropouts.
    // Keep the existing browser buffer and catch up when the next packet lands.
    if (this.primed && !this.frames.length && this.stopInput && Date.now() - this.lastInputAt < 1000) {
      this.tickTimer = setTimeout(() => this.tick(), 20);
      return;
    }
    const programme = this.primed ? this.frames.shift() : undefined;
    if (!programme) { if (this.primed && this.urls.length) this.underruns++; this.primed = false; }
    const frame = programme ?? this.silence[this.silenceIndex++ % this.silence.length];
    this.frameNumber++;
    for (const [client, state] of this.clients) {
      if (client.destroyed) { this.detach(client); continue; }
      // Dropping individual MP3 frames corrupts the decoder's bit reservoir
      // and the client's time mapping. Buffer a short hiccup in order; reconnect
      // a genuinely slow receiver instead of silently skipping programme.
      state.pending.push(frame);
      if (state.pending.length > 76) {
        this.slowDisconnects++;
        this.detach(client);
        if (client.destroy) client.destroy(); else client.end();
        continue;
      }
      this.flushClient(client, state);
    }
    this.nextFrameAt += MP3_FRAME_MS;
    if (this.nextFrameAt < performance.now() - 100) this.nextFrameAt = performance.now();
    this.tickTimer = setTimeout(() => this.tick(), Math.max(0, this.nextFrameAt - performance.now()));
  }

  private flushClient(client: Sink, state: { blocked: boolean; pending: Buffer[] }) {
    if (state.blocked || !this.clients.has(client)) return;
    try {
      while (state.pending.length) {
        if (!client.write(state.pending.shift()!)) {
          state.blocked = true;
          client.once("drain", () => { state.blocked = false; this.flushClient(client, state); });
          break;
        }
      }
    } catch { this.detach(client); client.destroy?.(); }
  }

  clock(listener: string) {
    // Duplicate requests with the same token cannot establish a trustworthy
    // media timeline. The player will request a fresh connection when absent.
    const matches = [...this.clients.values()].filter(client => client.listener === listener);
    if (!listener || matches.length !== 1) return undefined;
    const client = matches[0];
    return { listener, connection: client.connection, mediaSeconds: (this.frameNumber - client.firstFrame) * MP3_FRAME_MS / 1000 };
  }

  close() {
    if (this.closed) return;
    this.closed = true; this.revision++;
    if (this.tickTimer) clearTimeout(this.tickTimer);
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.stopInput?.(); this.stopInput = undefined;
    this.frames = [];
    for (const client of this.clients.keys()) client.end();
    this.clients.clear();
  }

  status(): "waiting" | "reconnecting" | "buffering" | "playing" {
    if (!this.urls.length) return "waiting";
    if (!this.stopInput) return "reconnecting";
    return !this.received || Date.now() - this.lastInputAt > 2000 ? "buffering" : "playing";
  }

  diagnostics() { return { clients: this.clients.size, bufferedFrames: this.frames.length, connected: !!this.stopInput, closed: this.closed, status: this.status(), reconnects: this.reconnects, underruns: this.underruns, slowDisconnects: this.slowDisconnects }; }
}
