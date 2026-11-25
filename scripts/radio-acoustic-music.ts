import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { prisma } from '../src/lib/prisma';
import { command, normalizeMusic } from '../src/lib/radio/store';
import { elevenLabsError } from '../src/lib/radio/elevenlabs';

// Explicit, bounded purchase. Re-running never buys a second copy of a track.
// Publication is separate and requires analysis of every minute of the audio.
const directory = resolve('artifacts/music-acoustic-20261125');
const prefix = 'music:acoustic-20261125:';
const perTrackReservation = 4000, batchBudget = 26000, newsReserve = 60000;
// The newest music model, requested at the highest offered bitrate and stored at 320 kbit/s.
const model = 'music_v2_5', outputFormat = 'mp3_48000_320';
// Rejected on 2026-11-25: "Still Air" with its long synthesizer sound. Real
// played instruments with constant gentle motion instead of held synth tones.
const SOUND = 'Real acoustic instruments only, played by musicians in a warm, clear, high-fidelity studio recording with natural room sound and full detail. STRICTLY NO synthesizer of any kind: no pads, no drones, no sustained synth chords, no ambient wash, no string pads, no long held or swelling tones, no electronic textures. Every bar has gentle melodic or rhythmic motion. NO wind instruments: no saxophone, trumpet, trombone, flute, clarinet, horns or brass. No vocals, humming or vocal samples. If drums are used, only feather-light brushes on snare and soft ride cymbal, low in the mix; no kick-driven beat, no claps, no electronic drums. Relaxed, warm, quietly positive and unobtrusive, comfortable under conversation, no solos that grab attention, no buildups or drama. No lo-fi processing, vinyl noise, distortion or filtering.';
const briefs = [
  { title: 'Showroom Velvet · Espresso', season: 'all', style: 'Acoustic jazz piano trio around 88 BPM: a natural grand piano plays a simple, singable original melody with gentle chord comping, an upright bass walks softly, brushes whisper on the snare. Bright, friendly major harmonies, light swing feel.' },
  { title: 'Velvet Floorplan · Nylon Breeze', season: 'all', style: 'Gentle bossa nova around 92 BPM: a nylon-string guitar plays the classic syncopated bossa accompaniment and a clear original melody, a grand piano adds sparse answering phrases, upright bass on the roots, very soft brushed snare and rim pattern. Sunny and relaxed.' },
  { title: 'Showroom Satin · Terrace', season: 'all', style: 'Warm vibraphone and piano quartet around 90 BPM: vibraphone with soft mallets carries an original melody, grand piano comps, upright bass, feather-light brushes. Café-terrace atmosphere, elegant and light, gentle swing.' },
  { title: 'Showroom Velvet · Sunday Drive', season: 'all', style: 'Acoustic guitar duo around 96 BPM: two steel-string acoustic guitars, one fingerpicking a lively rolling pattern, the other playing a warm original melody, with a soft upright bass. Optimistic folk-jazz, open major chords, like a relaxed drive on a sunny morning.' },
  { title: 'Velvet Floorplan · Rhodes Avenue', season: 'all', style: 'Smooth soul-jazz around 84 BPM: a vintage Rhodes electric piano with clear bell-like tone plays warm chords and an original melody, a clean jazz guitar answers, a round electric bass, soft brushes and closed hi-hat very low in the mix. Polished and positive, never sleepy.' },
  { title: 'Winterlicht · Kaminabend', season: 'winter', style: 'Cozy winter jazz piano trio around 80 BPM: grand piano with an original tender but warm melody and moving chords, upright bass, soft brushes. The feeling of a warm room on a cold evening. No sleigh bells, no Christmas carols, no music box, no celesta.' },
];

async function balance() {
  const response = await fetch('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY! }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('Music budget cannot be verified');
  const data = await response.json() as { character_limit: number; character_count: number };
  if (!Number.isFinite(data.character_limit) || !Number.isFinite(data.character_count)) throw new Error('Music balance unavailable');
  return Math.max(0, data.character_limit - data.character_count);
}

async function exists(path: string) { try { await readFile(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } }

async function main() {
  await mkdir(directory, { recursive: true });
  const budgetPath = join(directory, 'budget.json');
  const initialBalance = await exists(budgetPath) ? JSON.parse(await readFile(budgetPath, 'utf8')).initialBalance as number : await balance();
  if (!Number.isFinite(initialBalance)) throw new Error('Invalid saved budget');
  if (!process.argv.includes('--generate')) {
    console.log(JSON.stringify({ dryRun: true, initialBalance, batchBudget, newsReserve, briefs }));
    return;
  }
  if (!await exists(budgetPath)) await writeFile(budgetPath, JSON.stringify({ initialBalance, batchBudget, newsReserve, createdAt: new Date().toISOString() }, null, 2), { flag: 'wx' });
  const manifest = [];
  let reserved = 0;
  for (const [index, brief] of briefs.entries()) {
    const key = `${prefix}${index}`, rawPath = join(directory, `raw-${index}.mp3`), metaPath = join(directory, `generation-${index}.json`);
    let asset = await prisma.radioAsset.findUnique({ where: { key } });
    if (!asset) {
      let metadata: Record<string, any>;
      let raw: Buffer;
      if (await exists(rawPath)) {
        raw = await readFile(rawPath);
        if (!await exists(metaPath)) throw new Error('Purchased audio has no metadata; recover it instead of repurchasing');
        metadata = JSON.parse(await readFile(metaPath, 'utf8'));
      } else {
        // Persist an intent before sending a paid request. An ambiguous failure
        // needs provider-side recovery, never an automatic paid retry.
        const intentPath = join(directory, `request-${index}.json`);
        if (await exists(intentPath)) throw new Error(`Request ${index} already attempted; recover its result before retrying`);
        const before = await balance();
        if (Math.min(before, initialBalance - reserved) < newsReserve + perTrackReservation || reserved + perTrackReservation > batchBudget) {
          console.log(JSON.stringify({ budgetStop: true, remaining: before, reserved, newsReserve })); break;
        }
        if (await prisma.radioAsset.count({ where: { kind: { in: ['music', 'music-candidate'] } } }) >= 24) break;
        const prompt = `Compose an original complete four-minute instrumental lounge track for a welcoming premium car showroom. ${brief.style} ${SOUND} Even, gentle energy across all four minutes with small variations in melody and arrangement, and a clean relaxed ending. Do not quote or imitate any existing melody.`;
        metadata = { prompt, model, generated: true, forceInstrumental: true, requestedSeconds: 240, season: brief.season, outputFormat, normalizedBitrate: 320000, budgetReservationCredits: perTrackReservation, balanceBefore: before, generatedAt: new Date().toISOString() };
        await writeFile(intentPath, JSON.stringify(metadata, null, 2), { flag: 'wx' });
        console.log(JSON.stringify({ generating: brief.title, reserved: reserved + perTrackReservation, newsReserve }));
        const response = await fetch(`https://api.elevenlabs.io/v1/music?output_format=${outputFormat}`, {
          method: 'POST', headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY!, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, music_length_ms: 240000, model_id: model, force_instrumental: true }), signal: AbortSignal.timeout(360000),
        });
        if (!response.ok) { let error: unknown; try { error = await response.json(); } catch {} throw elevenLabsError(response.status, error); }
        if (!response.headers.get('content-type')?.includes('audio/')) throw new Error('Music provider returned no audio');
        raw = Buffer.from(await response.arrayBuffer());
        await writeFile(rawPath, raw, { flag: 'wx' });
        const headerCost = Number(response.headers.get('character-cost'));
        metadata = { ...metadata, billedCredits: headerCost > 0 ? headerCost : null, budgetReservationCredits: Math.max(perTrackReservation, headerCost || 0), costBasis: headerCost > 0 ? 'provider-response-header' : 'Unknown individual cost; account counters can settle multiple purchases together' };
        await writeFile(metaPath, JSON.stringify(metadata, null, 2));
      }
      const length = Number(await command(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', rawPath]));
      if (!Number.isFinite(length) || length < 210 || length > 245) throw new Error('Generated music is not a complete four-minute track');
      const audio = await normalizeMusic(raw, 250);
      asset = await prisma.radioAsset.create({ data: { key, kind: 'music-candidate', title: brief.title, ...audio, metadata } });
    }
    reserved += Number((asset.metadata as Record<string, unknown>)?.budgetReservationCredits || perTrackReservation);
    const file = `track-${index}.mp3`, sha256 = createHash('sha256').update(asset.audio).digest('hex');
    await writeFile(join(directory, file), asset.audio);
    manifest.push({ id: asset.id, key, title: asset.title, duration: asset.duration, season: brief.season, sha256, file });
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(JSON.stringify({ candidate: asset.title, duration: asset.duration, id: asset.id }));
  }
  console.log(JSON.stringify({ reserved, remaining: await balance(), newsReserve, candidates: manifest.length }));
}

main().catch(error => { console.error(error instanceof Error ? error.message : 'Music expansion failed'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
