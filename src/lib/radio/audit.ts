import { prisma } from "../prisma";
import { isRepeatSlot } from "./news";

export function trackPlayback(asset: { id: string; title: string; kind: string }, language: string, scheduledFor: Date | undefined, listeners: number) {
  const record = prisma.radioPlayback.create({ data: {
    assetId: asset.id, title: asset.title, kind: asset.kind, language, scheduledFor,
    repeated: !!scheduledFor && isRepeatSlot(scheduledFor), listeners, status: "starting",
  } }).catch(error => { console.error("[radio audit]", error instanceof Error ? error.message : "failed"); return null; });
  let finished: Promise<void> | undefined;
  return {
    started: async () => {
      const row = await record;
      if (row && !finished) await prisma.radioPlayback.updateMany({ where: { id: row.id, status: "starting" }, data: { status: "playing", startedAt: new Date() } });
    },
    finish: (status: "completed" | "interrupted" | "failed", error?: string) => {
      return finished ??= (async () => {
        const row = await record;
        if (row) await prisma.radioPlayback.update({ where: { id: row.id }, data: { status, endedAt: new Date(), error: error?.slice(0, 400) } });
      })().catch(e => { console.error("[radio audit]", e instanceof Error ? e.message : "failed"); });
    },
  };
}
