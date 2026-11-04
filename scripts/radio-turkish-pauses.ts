// Rebuild an existing daily edition exclusively from cached speech. Network
// requests are blocked so a missing cache can never buy another generation.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { bulletinKey, renderBulletin, type EditorialContent } from '../src/lib/radio/news';
import { familyAssetAllowed } from '../src/lib/radio/family';
import { TURKISH_DIVIDER_KEY } from '../src/lib/radio/imaging';

async function main() {
  const id = process.argv[2];
  if (!id) throw new Error('Supply the UUID of the existing Turkish daily edition');
  const source = await prisma.radioAsset.findUniqueOrThrow({ where: { id } });
  const metadata = source.metadata as Record<string, any>;
  if (metadata.supersededBy) {
    console.log(JSON.stringify({ alreadyCorrected: metadata.supersededBy }));
    return;
  }
  if (source.kind !== 'news' || metadata.language !== 'tr' || !source.slot || !familyAssetAllowed(source)) throw new Error('A reviewed Turkish daily edition is required');
  assert.equal(source.key, bulletinKey(source.slot), 'Only the active daily edition can be replaced');
  if (!metadata.timeline?.some((cue: { kind: string }) => cue.kind === 'divider')) {
    console.log(JSON.stringify({ alreadyDry: source.id }));
    return;
  }
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => { attempts++; throw new Error('All provider calls are forbidden during this audio correction'); };
  let rendered;
  try {
    const content: EditorialContent = {
      language: 'tr', editionSlot: metadata.editionSlot || source.slot.toISOString(),
      stories: metadata.stories, sources: metadata.sources, modelCalls: metadata.modelCalls || [],
    };
    rendered = await renderBulletin(source.slot, content);
  } finally { globalThis.fetch = originalFetch; }
  assert.equal(attempts, 0, 'Correction must use cached speech only');
  assert.equal(rendered.script, source.script, 'Spoken words must be unchanged');
  assert.equal(rendered.metadata.timeline.some(cue => cue.kind === 'divider'), false);
  const beforeStories = metadata.timeline.filter((cue: { kind: string }) => cue.kind === 'story');
  const afterStories = rendered.metadata.timeline.filter(cue => cue.kind === 'story');
  assert.equal(afterStories.length, beforeStories.length, 'All stories must survive the correction');
  for (let i = 0; i < afterStories.length; i++) {
    assert.ok(Math.abs((afterStories[i].end - afterStories[i].start) - (beforeStories[i].end - beforeStories[i].start)) < 0.05, 'Never shorten a spoken story');
  }
  const correctedId = randomUUID(), correctedAt = new Date().toISOString();
  const combined: Record<string, unknown> = { ...metadata, ...rendered.metadata, correctedAt,
    correction: 'Zwischentöne entfernt; natürliche Sprechpausen. Texte, Stimmen, Intro und Outro unverändert.',
    remixedFrom: source.id, originalCreatedAt: source.createdAt.toISOString(),
    audioCorrection: { providerCalls: 0, speechRegenerated: false, style: 'speech-pauses-v1' },
  };
  if (combined.audioDesignReview) {
    combined.sourceAudioDesignReview = combined.audioDesignReview;
    delete combined.audioDesignReview;
  }
  await prisma.$transaction(async tx => {
    await tx.radioAsset.update({ where: { id: source.id }, data: {
      key: `${source.key}:superseded:${source.id}`,
      metadata: { ...metadata, supersededBy: correctedId } as Prisma.InputJsonValue,
    } });
    await tx.radioAsset.create({ data: {
      id: correctedId, key: source.key, kind: 'news', title: source.title, slot: source.slot,
      script: source.script, audio: rendered.audio, duration: rendered.duration,
      metadata: combined as Prisma.InputJsonValue,
    } });
    const divider = await tx.radioAsset.findUnique({ where: { key: TURKISH_DIVIDER_KEY }, select: { id: true, metadata: true } });
    if (divider) await tx.radioAsset.update({ where: { id: divider.id }, data: {
      metadata: { ...(divider.metadata as object), retired: true, retiredAt: correctedAt, retirementReason: 'User rejected this transition; active Turkish editions use speech pauses' },
    } });
  });
  const directory = resolve('artifacts/turkish-natural-pauses');
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, 'corrected-edition.mp3'), rendered.audio);
  const report = { id: correctedId, originalId: source.id, originalDuration: source.duration,
    duration: rendered.duration, stories: afterStories.length, dividers: 0, providerCalls: attempts,
    scriptUnchanged: true, historicalPlaybackPreserved: true, timeline: rendered.metadata.timeline };
  await writeFile(resolve(directory, 'correction.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Turkish pause correction failed');
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
