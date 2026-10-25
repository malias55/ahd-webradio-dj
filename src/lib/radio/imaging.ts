import { prisma } from "../prisma";
import { composeMusic, soundEffect, speech, presenterForSlot, presenterForHour, servicePresenter } from "./providers";
import { normalizeAudio, withJob } from "./store";

export const IMAGING_VERSION = "v1";
export const STATION_ID_VERSION = "dry-v2";
export const IMAGING_ROLES = ["news-open", "news-bed", "news-close", "station-bed", "sweep", "divider"] as const;
export type ImagingRole = typeof IMAGING_ROLES[number];
const signature = "Original coherent sonic branding for Autohaus Doerrschuck Radio in Mainz. Warm premium lounge jazz, D major, 96 BPM, memorable three-note rising Rhodes and soft vibraphone motif. Welcoming, confident, sunny and understated. Pure instrumental. No speech, no singing, no urgent news alarm, no dramatic impacts, no harsh treble.";
export const IMAGING_BRIEF: { role: ImagingRole; title: string; seconds: number; prompt: string; effect?: boolean }[] = [
  { role: "news-open", title: "Mainz Moment · Nachrichten-Opener", seconds: 6, prompt: `${signature} Six-second radio news opener. Immediate elegant three-note signature, a light brushed rhythmic pickup, airy shimmer, then a gentle clean resolved tail with space for the presenter from second three. Broadcast polish without sounding like a hard-news station.` },
  { role: "news-bed", title: "Mainz Moment · Nachrichtenbett", seconds: 60, prompt: `${signature} Sixty-second seamless loopable spoken-news underscore. Extremely sparse warm Rhodes chords, rounded bass and barely audible brushed percussion. No solo melody or changing lead lines. Consistent D major groove, no build-up, no intro, no big ending, stable energy, plenty of midrange space for German speech.` },
  { role: "news-close", title: "Mainz Moment · Zurück zur Musik", seconds: 5, prompt: `${signature} Five-second radio news outro. Answer the same three-note motif with a short relaxed electric-piano and guitar flourish. Pleasant resolution, very light rhythm, natural soft tail, clean exit back into instrumental lounge music.` },
  { role: "station-bed", title: "Mainz Moment · Senderkennung", seconds: 12, prompt: `${signature} Twelve-second station-ident instrumental. Signature in the first two seconds, sparse groove and warm chords under the voice from seconds two to nine, short recognizable signature again at the end, gentle finish. Smooth jazz guitar accents and soft electronic detail.` },
  { role: "sweep", title: "Satin Air · Übergang", seconds: 1.2, effect: true, prompt: "A restrained luxury-radio transition: a very soft airy stereo swoosh, rising gently into a delicate warm glass sparkle, then a smooth short tail. Clean studio sound, elegant and optimistic. No speech, no voices, no engine, no alarm, no loud impact or sharp hiss. Exactly one short transition." },
  { role: "divider", title: "Velvet Notes · Nachrichtentrenner", seconds: 1.1, effect: true, prompt: "A friendly premium lounge radio news separator. Two very short warm electric piano and soft vibraphone notes in D major, with a tiny soft brushed click and airy tail. Clear but restrained, no sharp highs, no alarms, no speech, no dramatic impact. One single elegant punctuation sound." },
];

export function imagingKey(role: ImagingRole) { return `imaging:${IMAGING_VERSION}:${role}`; }
export async function imagingAsset(role: ImagingRole) {
  return prisma.radioAsset.findUniqueOrThrow({ where: { key: imagingKey(role) }, select: { id: true, duration: true, title: true, kind: true } });
}

export async function generateImaging() {
  for (const brief of IMAGING_BRIEF) {
    const key = imagingKey(brief.role);
    if (await prisma.radioAsset.findUnique({ where: { key }, select: { id: true } })) continue;
    await withJob(key, async () => {
      const raw = brief.effect ? await soundEffect(brief.prompt, brief.seconds) : await composeMusic(brief.prompt, brief.seconds);
      const audio = await normalizeAudio(raw, brief.seconds + 0.5);
      await prisma.radioAsset.create({ data: { key, kind: "imaging", title: brief.title, ...audio,
        metadata: { role: brief.role, version: IMAGING_VERSION, generated: true, prompt: brief.prompt } } });
    });
  }
}

export const STATION_LINE = "Autohaus Dörrschuck Radio. Entspannt ankommen. Gute Musik. Gute Fahrt.";
export function stationIdKey(slot: Date) {
  const p = presenterForSlot(slot);
  return `station-id:${STATION_ID_VERSION}:${p.gender}:${p.voiceId}`;
}

export async function stationIdAsset(slot: Date) {
  return prisma.radioAsset.findUnique({ where: { key: stationIdKey(slot) }, select: { id: true, title: true, duration: true, kind: true } });
}

export async function generateStationIds(render: (voice: Buffer, bedId: string) => Promise<{ audio: Uint8Array<ArrayBuffer>; duration: number }>) {
  const bed = await imagingAsset("station-bed");
  for (const presenter of [presenterForHour(8), servicePresenter()]) {
    const key = `station-id:${STATION_ID_VERSION}:${presenter.gender}:${presenter.voiceId}`;
    if (await prisma.radioAsset.findUnique({ where: { key }, select: { id: true } })) continue;
    await withJob(key, async () => {
      const audio = await render(await speech(STATION_LINE, presenter.voiceId), bed.id);
      await prisma.radioAsset.create({ data: { key, kind: "station-id", title: `Senderkennung · ${presenter.name}`, script: STATION_LINE, ...audio,
        metadata: { version: STATION_ID_VERSION, voiceId: presenter.voiceId, presenter: presenter.name, backgroundMusic: false } } });
    });
  }
}
