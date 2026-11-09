import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { prisma } from '../src/lib/prisma';
import { command, normalizeMusic } from '../src/lib/radio/store';
import { elevenLabsError } from '../src/lib/radio/elevenlabs';
import { QUIET_MUSIC_PROMPT } from '../src/lib/radio/music-policy';

// Explicit, bounded purchase. Re-running never buys a second copy of a track.
// Publication is separate and requires analysis of every minute of the audio.
const directory = resolve('artifacts/music-soft-replacements-20261109');
const prefix = 'music:soft-replacements-20261109:';
const perTrackReservation = 4000, batchBudget = 8000, newsReserve = 40000;
const briefs = [
  { title: 'Showroom Velvet · Soft Light', season: 'all', style: 'DRUMLESS warm acoustic lounge, around 70 BPM with a relaxed natural flow. Only softly played felt piano and warm nylon guitar, occasional long mellow bass tones. Spacious major seventh and ninth harmonies, restrained middle-register melody and slow elegant chord changes. Welcoming and quietly optimistic. No rhythm section, no percussion, no synth leads, no strong bass notes. Soft rounded instrument attacks. A clear intimate studio recording with natural sustain and no electronic texture.' },
  { title: 'Velvet Floorplan · Still Air', season: 'all', style: 'DRUMLESS mellow Rhodes lounge, around 74 BPM in relaxed free-flowing phrasing. Only warm electric piano chords, a few gentle nylon guitar answers, and a thin sustained warm pad. Airy and positive with varied, spacious harmonic movement. No rhythm section, bass ostinato, percussion, synth melody, bright arpeggios or accents. Smooth rounded attacks. Natural clean studio sound, no lo-fi filtering or warbling effects. Soft ending.' },
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
        const prompt = `Compose an original complete four-minute instrumental background track for a welcoming car showroom. ${brief.style} ${QUIET_MUSIC_PROMPT} Maintain very even low energy across the entire four minutes, gentle variations without a buildup, and a clean relaxed ending. No singing, spoken words or vocal chops. Do not quote or imitate any existing melody.`;
        const model = process.env.ELEVENLABS_MUSIC_MODEL || 'music_v2';
        metadata = { prompt, model, generated: true, forceInstrumental: true, requestedSeconds: 240, season: brief.season, outputFormat: 'auto', normalizedBitrate: 256000, budgetReservationCredits: perTrackReservation, balanceBefore: before, generatedAt: new Date().toISOString() };
        await writeFile(intentPath, JSON.stringify(metadata, null, 2), { flag: 'wx' });
        console.log(JSON.stringify({ generating: brief.title, reserved: reserved + perTrackReservation, newsReserve }));
        const response = await fetch('https://api.elevenlabs.io/v1/music?output_format=auto', {
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
