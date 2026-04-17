import type { NextRequest } from "next/server";
import { attachSubscriber, detachSubscriber, hasAnyRelay } from "@/lib/broadcast";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Live MP3 endpoint: the server transcodes the incoming browser WebM/Opus
// chunks into MP3 so every client (iOS Safari, Android, desktop, mpv) can play.
export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (!hasAnyRelay(id)) return new Response("no active broadcast", { status: 404 });

  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;
  // Queue chunks that arrive before the ReadableStream's start() is called;
  // otherwise first MP3 frames would be dropped while Next.js wires up the body.
  const pending: Uint8Array[] = [];

  const sink = {
    write(chunk: Buffer) {
      if (closed) return false;
      const u8 = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      if (controller) {
        try { controller.enqueue(u8); } catch { closed = true; detachSubscriber(id, sink); }
      } else {
        pending.push(u8);
      }
      return true;
    },
    end() {
      closed = true;
      if (controller) { try { controller.close(); } catch { /* noop */ } }
      detachSubscriber(id, sink);
    },
  };

  const attached = attachSubscriber(id, sink);
  if (!attached) return new Response("no active broadcast", { status: 404 });

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      for (const chunk of pending) { try { c.enqueue(chunk); } catch { /* noop */ } }
      pending.length = 0;
    },
    cancel() { closed = true; detachSubscriber(id, sink); },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-cache, no-store",
      "X-Accel-Buffering": "no",
      "Connection": "keep-alive",
      "X-Relay-Kind": attached.kind,
    },
  });
}
