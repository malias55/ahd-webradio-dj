// Single-byte ranges allow native audio players to seek without another full MP3.
export function audioResponse(audio: Uint8Array, range: string | null) {
  const size = audio.byteLength;
  const headers = { "Content-Type": "audio/mpeg", "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600" };
  if (!range) return new Response(new Uint8Array(audio), { headers: { ...headers, "Content-Length": String(size) } });
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start)
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
  return new Response(new Uint8Array(audio.slice(start, end + 1)), { status: 206, headers: { ...headers, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${size}` } });
}
