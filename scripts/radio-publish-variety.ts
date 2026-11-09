import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { prisma } from '../src/lib/prisma';
import { command, normalizeAudio } from '../src/lib/radio/store';
import { musicInRotation } from '../src/lib/radio/music-policy';

const directory = resolve('artifacts/music-variety-20261109');
type Clip = { file: string; audio_perceived: boolean; wind_instruments: string; wind_events: { seconds_into_clip: number; description: string }[]; vocals: string; harshness_1_to_5: number; energy_1_to_5: number; comfortable_under_conversation: boolean; heard_description: string };
type Review = { id: string; sha256: string; model: string; parts: { file: string; start: number; duration: number }[]; assessment: { clips: Clip[] } };
const hash = (audio: Uint8Array) => createHash('sha256').update(audio).digest('hex');

async function main() {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')) as { id: string; key: string; sha256: string; file: string; duration: number }[];
  if (manifest.length !== 4) throw new Error('The complete four-track batch is required');
  const reviews = JSON.parse(await readFile(join(directory, 'single-reviews.json'), 'utf8')) as Review[];
  const report: Record<string, unknown>[] = [];
  // The source files remain archived in music-candidate. No paid regeneration.
  for (const [index, item] of manifest.entries()) {
    const source = await prisma.radioAsset.findUniqueOrThrow({ where: { id: item.id } });
    if (source.key !== `music:gentle-variety-20261109:${index}` || hash(source.audio) !== item.sha256) throw new Error('Reviewed audio changed');
    const allSections = reviews.filter(r => r.id === source.id && r.sha256 === item.sha256).sort((a, b) => a.parts[0].start - b.parts[0].start);
    if (allSections.length !== 4) throw new Error('Incomplete analysis');
    const selectedSeconds = index === 2 ? 180 : 240;
    const sections = allSections.filter(r => r.parts[0].start < selectedSeconds);
    const approved = index !== 0;
    if (approved) {
      for (const [sectionIndex, section] of sections.entries()) {
        if (!section.model.startsWith('gpt-audio-') || section.parts.length !== 1 || section.parts[0].start !== sectionIndex * 60 || section.parts[0].duration !== 60 || section.assessment.clips.length !== 1) throw new Error('Non-contiguous review');
        const clip = section.assessment.clips[0];
        if (clip.file !== section.parts[0].file || clip.audio_perceived !== true || clip.wind_instruments !== 'absent' || clip.wind_events.length || clip.vocals !== 'absent' || !Number.isFinite(clip.harshness_1_to_5) || clip.harshness_1_to_5 > 2 || !Number.isFinite(clip.energy_1_to_5) || clip.energy_1_to_5 > 3 || clip.comfortable_under_conversation !== true) throw new Error(`Review does not approve ${source.title}`);
      }
    }
    let asset = source;
    const reason = index === 0 ? 'Excluded: saxophone-like lead reported at 60–120 seconds; also inconsistent energy assessments for the ending.'
      : index === 2 ? 'Use only the first three minutes with a six-second fade-out. An initial multi-clip assessment flagged the final minute as too energetic; this contradicted a later single-clip assessment, so the disputed ending is omitted conservatively.'
      : 'Every minute analyzed individually: no winds or vocals reported; low harshness and suitable under conversation.';
    if (index === 2) {
      const key = `${source.key}:soft-edit`;
      const existing = await prisma.radioAsset.findUnique({ where: { key } });
      if (existing) {
        if ((existing.metadata as any)?.sourceSha256 !== item.sha256) throw new Error('Existing edit has a different source');
        asset = existing;
      } else {
        const edit = join(directory, 'amber-soft-edit.mp3');
        await command(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-nostdin', '-i', join(directory, item.file), '-t', '180', '-af', 'afade=t=out:st=174:d=6:curve=hsin', '-c:a', 'libmp3lame', '-b:a', '128k', '-y', edit]);
        const audio = await normalizeAudio(await readFile(edit), 181);
        asset = await prisma.radioAsset.create({ data: { key, kind: 'music-candidate', title: source.title, ...audio, metadata: { ...(source.metadata as Record<string, any>), sourceAssetId: source.id, sourceSha256: item.sha256, edit: { start: 0, end: 180, fadeOutSeconds: 6 }, additionalGenerationCredits: 0 } } });
      }
      await writeFile(join(directory, 'amber-soft-edit.mp3'), asset.audio);
    }
    const audit = { version: 'gentle-variety-2026-11-09', reviewedAt: new Date().toISOString(), humanListeningCheck: false, method: 'Automated single-clip audio analysis covering each minute; descriptions inspected before publication', sourceSha256: item.sha256, audioSha256: hash(asset.audio), reviewedRange: { start: 0, end: selectedSeconds }, inRotation: approved, reason, sections: approved ? sections : allSections };
    report.push({ id: asset.id, sourceAssetId: source.id, title: asset.title, duration: asset.duration, season: (asset.metadata as any)?.season, ...audit });
    // Dry run creates the reversible edit and report for inspection, but does
    // not make any candidate available to the station.
    if (process.argv.includes('--publish')) {
      await prisma.radioAsset.update({ where: { id: asset.id }, data: { kind: approved ? 'music' : 'music-candidate', metadata: { ...(asset.metadata as Record<string, any>), gentleMusicReview: audit } } });
      if (asset.id !== source.id) await prisma.radioAsset.update({ where: { id: source.id }, data: { metadata: { ...(source.metadata as Record<string, any>), gentleMusicReview: { ...audit, audioSha256: item.sha256, inRotation: false, approvedEditId: asset.id } } } });
    }
  }
  await writeFile(join(directory, 'publication-review.json'), JSON.stringify(report, null, 2));
  const pool = (await prisma.radioAsset.findMany({ where: { kind: 'music' }, select: { id: true, title: true, kind: true, metadata: true, duration: true } })).filter(musicInRotation);
  console.log(JSON.stringify({ published: process.argv.includes('--publish'), decisions: report.map(({ title, duration, inRotation, reason }) => ({ title, duration, inRotation, reason })), activeTracks: pool.length, activeMinutes: pool.reduce((sum, a) => sum + a.duration, 0) / 60 }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Music publication failed'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
