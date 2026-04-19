import type { NextRequest } from "next/server";
import { attachSubscriber, attachToRelay, detachSubscriber, detachFromRelay, hasAnyRelay, hasRelay } from "@/lib/broadcast";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const url = new URL(req.url);
  const relayId = url.searchParams.get("r");

  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;
  const pending: Uint8Array[] = [];

  const sink = {
    write(chunk: Buffer) {
      if (closed) return false;
      const u8 = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      if (controller) {
        try { controller.enqueue(u8); } catch { closed = true; cleanup(); }
      } else {
        pending.push(u8);
      }
      return true;
    },
    end() {
      closed = true;
      if (controller) { try { controller.close(); } catch { /* noop */ } }
      cleanup();
    },
  };

  function cleanup() {
    if (relayId) { detachFromRelay(relayId, sink); }
    else { detachSubscriber(id, sink); }
  }

  let kind: string;
  if (relayId) {
    if (!hasRelay(relayId)) return new Response("no active broadcast", { status: 404 });
    const attached = attachToRelay(relayId, sink);
    if (!attached) return new Response("no active broadcast", { status: 404 });
    kind = attached.kind;
  } else {
    if (!hasAnyRelay(id)) return new Response("no active broadcast", { status: 404 });
    const attached = attachSubscriber(id, sink);
    if (!attached) return new Response("no active broadcast", { status: 404 });
    kind = attached.kind;
  }

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      for (const chunk of pending) { try { c.enqueue(chunk); } catch { /* noop */ } }
      pending.length = 0;
    },
    cancel() { closed = true; cleanup(); },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-cache, no-store",
      "X-Accel-Buffering": "no",
      "Connection": "keep-alive",
      "X-Relay-Kind": kind,
    },
  });
}
