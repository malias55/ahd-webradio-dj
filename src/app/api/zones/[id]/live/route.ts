import type { NextRequest } from "next/server";
import { attachSubscriber, detachSubscriber, hasRelay, relayOutputMime } from "@/lib/broadcast";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Live MP3 endpoint: the server transcodes the incoming browser WebM/Opus
// chunks into MP3 so every client (iOS Safari, Android, desktop, mpv) can play.
export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (!hasRelay(id)) return new Response("no active broadcast", { status: 404 });

  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;

  const sink = {
    write(chunk: Buffer) {
      if (closed) return false;
      const u8 = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      if (controller) {
        try { controller.enqueue(u8); } catch { closed = true; detachSubscriber(id, sink); }
      }
      return true;
    },
    end() {
      closed = true;
      if (controller) { try { controller.close(); } catch { /* noop */ } }
      detachSubscriber(id, sink);
    },
  };

  attachSubscriber(id, sink);

  const stream = new ReadableStream<Uint8Array>({
    start(c) { controller = c; },
    cancel() { closed = true; detachSubscriber(id, sink); },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": relayOutputMime(id),
      "Cache-Control": "no-cache, no-store",
      "X-Accel-Buffering": "no",
      "Connection": "keep-alive",
    },
  });
}
