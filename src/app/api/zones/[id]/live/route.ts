import type { NextRequest } from "next/server";
import { attachSubscriber, detachSubscriber, hasRelay } from "@/lib/broadcast";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Live audio endpoint consumed by Pi devices (mpv can stream webm/opus over HTTP).
// Chunks received before the ReadableStream starts pulling are queued, then flushed.
export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (!hasRelay(id)) return new Response("no active broadcast", { status: 404 });

  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const pending: Uint8Array[] = [];
  let closed = false;

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

  // Register BEFORE building the stream, so chunks that arrive during response
  // setup are queued rather than dropped.
  attachSubscriber(id, sink);

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      for (const chunk of pending) { try { c.enqueue(chunk); } catch { /* noop */ } }
      pending.length = 0;
    },
    cancel() {
      closed = true;
      detachSubscriber(id, sink);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "audio/webm",
      "Cache-Control": "no-cache, no-store",
      "X-Accel-Buffering": "no",
      "Connection": "keep-alive",
    },
  });
}
