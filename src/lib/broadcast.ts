type ChunkSink = { write: (c: Buffer) => boolean | void; end: () => void };

type Relay = {
  zoneId: string;
  mime: string;
  initChunk: Buffer | null;
  subscribers: Set<ChunkSink>;
  startedAt: number;
};

const relays = new Map<string, Relay>();

export function startRelay(zoneId: string, mime: string): Relay {
  const existing = relays.get(zoneId);
  if (existing) {
    closeAllSubscribers(existing);
    relays.delete(zoneId);
  }
  const r: Relay = {
    zoneId,
    mime,
    initChunk: null,
    subscribers: new Set(),
    startedAt: Date.now(),
  };
  relays.set(zoneId, r);
  return r;
}

export function stopRelay(zoneId: string) {
  const r = relays.get(zoneId);
  if (!r) return false;
  closeAllSubscribers(r);
  relays.delete(zoneId);
  return true;
}

export function hasRelay(zoneId: string) {
  return relays.has(zoneId);
}

export function pushChunk(zoneId: string, chunk: Buffer) {
  const r = relays.get(zoneId);
  if (!r) return 0;
  if (!r.initChunk) r.initChunk = chunk;
  let delivered = 0;
  for (const sub of r.subscribers) {
    try {
      sub.write(chunk);
      delivered++;
    } catch {
      r.subscribers.delete(sub);
    }
  }
  return delivered;
}

export function attachSubscriber(zoneId: string, sink: ChunkSink): Relay | null {
  const r = relays.get(zoneId);
  if (!r) return null;
  r.subscribers.add(sink);
  if (r.initChunk) {
    try { sink.write(r.initChunk); } catch { r.subscribers.delete(sink); }
  }
  return r;
}

export function detachSubscriber(zoneId: string, sink: ChunkSink) {
  const r = relays.get(zoneId);
  if (!r) return;
  r.subscribers.delete(sink);
}

function closeAllSubscribers(r: Relay) {
  for (const sub of r.subscribers) {
    try { sub.end(); } catch { /* noop */ }
  }
  r.subscribers.clear();
}

export function relayStats() {
  return Array.from(relays.values()).map((r) => ({
    zoneId: r.zoneId,
    mime: r.mime,
    subscribers: r.subscribers.size,
    startedAt: r.startedAt,
  }));
}
