import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { prisma } from '../src/lib/prisma';

// Applies `radio-review-music.py <dir> --acoustic` to the rotation. A track
// plays only if EVERY reviewed minute is free of synthesizer pads, held tones,
// wind instruments, vocals and audible defects, and keeps gentle motion.
// Usage: radio-publish-acoustic-music.ts <dir> [--apply]   (default: dry run)
type Clip = {
  audio_perceived?: boolean; synth_or_pad?: string; sustained_tone_prominence_1_to_5?: number; motion_1_to_5?: number;
  wind_instruments?: string; vocals?: string; rendering_quality?: string; pleasant_showroom_background?: boolean; synth_evidence?: string; reason?: string;
};
type Report = { id: string; title: string; parts: { start: number }[]; model: string; assessment: { clips: Clip[] } };

export function minuteProblems(clip: Clip) {
  const problems: string[] = [];
  if (clip.audio_perceived !== true) problems.push('audio not perceived');
  if (clip.synth_or_pad !== 'absent') problems.push(`synth/pad ${clip.synth_or_pad}${clip.synth_evidence ? `: ${clip.synth_evidence}` : ''}`);
  if (!(Number(clip.sustained_tone_prominence_1_to_5) <= 2)) problems.push(`held tones ${clip.sustained_tone_prominence_1_to_5}`);
  if (!(Number(clip.motion_1_to_5) >= 3)) problems.push(`little motion ${clip.motion_1_to_5}`);
  if (clip.wind_instruments !== 'absent') problems.push(`wind ${clip.wind_instruments}`);
  if (clip.vocals !== 'absent') problems.push(`vocals ${clip.vocals}`);
  if (!['clean', 'minor_artifacts'].includes(String(clip.rendering_quality))) problems.push(`rendering ${clip.rendering_quality}`);
  if (clip.pleasant_showroom_background !== true) problems.push('not pleasant background');
  return problems;
}

async function main() {
  const [directory] = process.argv.slice(2), apply = process.argv.includes('--apply');
  if (!directory) throw new Error('Review directory required');
  const reports = JSON.parse(await readFile(join(directory, 'acoustic-reviews.json'), 'utf8')) as Report[];
  const byTrack = new Map<string, Report[]>();
  for (const report of reports) byTrack.set(report.id, [...byTrack.get(report.id) ?? [], report]);
  const result = [];
  for (const [id, minutes] of byTrack) {
    const asset = await prisma.radioAsset.findUniqueOrThrow({ where: { id } });
    if (!['music', 'music-candidate'].includes(asset.kind)) throw new Error('Not a music track');
    const problems = minutes.flatMap(m => m.assessment.clips.flatMap(c => minuteProblems(c).map(p => `min ${m.parts[0].start / 60}: ${p}`)));
    const rotationEnabled = problems.length === 0;
    if (apply) {
      const metadata = { ...(asset.metadata as object), rotationEnabled,
        acousticReview: { model: minutes[0].model, reviewedAt: new Date().toISOString(), scope: 'Every minute of the track, one request per minute', humanListeningCheck: false, problems } };
      await prisma.radioAsset.update({ where: { id }, data: { kind: rotationEnabled ? 'music' : asset.kind, metadata } });
    }
    result.push({ title: asset.title, rotationEnabled, problems });
  }
  console.log(JSON.stringify({ applied: apply, result }, null, 2));
}

main().catch(error => { console.error(error instanceof Error ? error.message : 'Publication failed'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
