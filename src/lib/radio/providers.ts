import { naturalRadioText, usesUpdatedBulletinAudio } from "./presentation";
import { QUIET_MUSIC_PROMPT } from "./music-policy";
import { assertFamilyContent } from "./family";
import { speechText } from "./pronunciation";
import { prisma } from "../prisma";
import { normalizeMusic, withJob } from "./store";
import { stationTime } from "./config";
import { elevenLabsError } from "./elevenlabs";

export function presenterForSlot(slot: Date) {
  return presenterForHour(stationTime(slot).hour);
}
export function presenterForHour(hour: number) {
  if (hour === 7 || hour === 20) return { gender: "male" as const, name: "Cavit", language: "tr" as const, voiceId: process.env.ELEVENLABS_TURKISH_VOICE_ID || "Q2IX97JeHBY3vNGzgM5s", assistant: "yapay zekâ haber sunucunuz" };
  return { gender: "male" as const, name: "Elias", language: "de" as const, voiceId: process.env.ELEVENLABS_MALE_VOICE_ID || "1h6gHcRvQugDNZgdAo9N", assistant: "Ihr KI-Nachrichtenassistent" };
}
export function servicePresenter(slot = new Date()) {
  const defaultVoice = usesUpdatedBulletinAudio(slot) ? "NX39CipaoYitJ3sMwH5I" : "mjTSjCqHhkhULvdsy68o";
  return { gender: "female" as const, name: process.env.ELEVENLABS_SERVICE_VOICE_NAME || "Susanne", language: "de" as const, voiceId: process.env.ELEVENLABS_SERVICE_VOICE_ID || defaultVoice, assistant: "Ihre KI-Moderatorin für Wetter und Verkehr" };
}

export function composeMusic(prompt: string, seconds: number) {
  return eleven("/v1/music?output_format=mp3_48000_320", {
    prompt, music_length_ms: Math.round(seconds * 1000), model_id: process.env.ELEVENLABS_MUSIC_MODEL || "music_v2_5", force_instrumental: true,
  }, 360_000);
}

export function soundEffect(text: string, seconds: number) {
  return eleven("/v1/sound-generation?output_format=mp3_44100_128", {
    text, duration_seconds: seconds, prompt_influence: 0.65, model_id: "eleven_text_to_sound_v2",
  });
}

async function eleven(path: string, body: unknown, timeout = 120_000) {
  if (!process.env.ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY fehlt");
  const r = await fetch(`https://api.elevenlabs.io${path}`, {
    method: "POST", headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(timeout),
  });
  // Don't include provider response bodies: they can contain echoed request data or credentials.
  if (!r.ok) {
    let error: unknown;
    try { error = await r.json(); } catch {}
    throw elevenLabsError(r.status, error);
  }
  if (!(r.headers.get("content-type") || "").includes("audio/")) throw new Error("ElevenLabs returned no audio");
  return Buffer.from(await r.arrayBuffer());
}

export async function germanVoice() {
  if (process.env.ELEVENLABS_VOICE_ID) return process.env.ELEVENLABS_VOICE_ID;
  if (!process.env.ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY fehlt");
  const r = await fetch("https://api.elevenlabs.io/v2/voices?language=de&page_size=100", {
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY }, signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`ElevenLabs voices HTTP ${r.status}`);
  const data = await r.json() as { voices: { voice_id: string; name: string; labels?: Record<string, string>; verified_languages?: { language: string }[] }[] };
  const voices = data.voices.filter(v => v.labels?.language === "de" || v.labels?.language?.toLowerCase() === "german" || v.verified_languages?.some(l => l.language === "de"));
  const suitable = voices.filter(v => v.labels?.use_case !== "characters_animation" && !/cute|child|tiny|sweet/i.test(v.name + JSON.stringify(v.labels)));
  suitable.sort((a, b) => {
    const score = (v: typeof a) => (v.labels?.gender === "female" ? 2 : 0) + (/news|narrat|professional|warm/i.test(JSON.stringify(v.labels)) ? 1 : 0);
    return score(b) - score(a) || a.voice_id.localeCompare(b.voice_id);
  });
  if (!suitable[0]) throw new Error("Keine deutsche Stimme gefunden. ELEVENLABS_VOICE_ID setzen.");
  return suitable[0].voice_id;
}

export type SpeechDelivery = "standard" | "service";
export function serviceVoiceSettings(slot: Date) {
  const updated = usesUpdatedBulletinAudio(slot);
  return { stability: updated ? 0.48 : 0.4, similarity_boost: 0.75, style: updated ? 0.08 : 0.15, speed: updated ? 1.03 : 1.06, use_speaker_boost: true };
}
export async function speech(text: string, voiceId: string, language: "de" | "tr" = "de", delivery: SpeechDelivery = "standard", slot = new Date()) {
  assertFamilyContent(text);
  const spoken = naturalRadioText(text);
  if (!spoken) throw new Error("Kein verwendbarer Radiotext");
  return eleven(`/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    text: speechText(spoken, language), model_id: process.env.ELEVENLABS_TTS_MODEL || "eleven_multilingual_v2", language_code: language,
    // Explicit German/Turkish words anchor the language even for Multilingual
    // v2 (which ignores language_code); normalize remaining ordinal grammar.
    apply_text_normalization: "on",
    voice_settings: delivery === "service" ? serviceVoiceSettings(slot) : { stability: 0.65, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true },
  });
}

export { editorialJson as edenJson, newsModelConfig, editorialConfigured, type ModelCall } from "./models";

export const MUSIC_STYLES = [
  { title: "Showroom Velvet", prompt: "Refined drumless instrumental lounge for a welcoming car showroom. Warm Rhodes piano with soft rounded attacks, spacious major ninth harmonies and quiet sustained bass. Relaxed flowing phrasing around 72 BPM, without a beat or a bass pulse. Elegant, quietly optimistic and comfortable." },
  { title: "Velvet Floorplan", prompt: "Airy drumless acoustic lounge for a premium car showroom. Gently played natural grand piano, soft fingerpicked nylon guitar, occasional warm bass notes. Spacious major harmonies around 70 BPM with subtle melodic variation. Clear, welcoming and unobtrusive, with no dramatic tension or rhythmic accents." },
  { title: "Showroom Satin", prompt: "Soft drumless instrumental lounge for a friendly car showroom. Mellow nylon guitar, warm electric piano and sparse sustained bass around 76 BPM. Restrained, sunny and polished. Sparse middle-register phrases with rounded attacks, no featured solos or recurring percussive accents." },
];

export async function generateMusic() {
  const count = await prisma.radioAsset.count({ where: { kind: "music" } });
  if (count >= 24) throw new Error("Musikpool voll (24 Titel). Vorhandene Titel werden weitergespielt.");
  // One explicit request creates at most three tracks; playback itself never buys new music.
  const batch = Math.floor(count / 3);
  for (let i = 0; i < 3; i++) {
    if (await prisma.radioAsset.count({ where: { kind: "music" } }) >= 24) break;
    const style = MUSIC_STYLES[i];
    const key = `music:${batch}:${i}`;
    await withJob(key, async () => {
      if (await prisma.radioAsset.findUnique({ where: { key }, select: { id: true } })) return;
      const raw = await composeMusic(`${style.prompt} ${QUIET_MUSIC_PROMPT}`, 180);
      const audio = await normalizeMusic(raw, 240);
      await prisma.radioAsset.create({ data: { key, kind: "music", title: `${style.title} ${batch + 1}`, ...audio, metadata: { prompt: `${style.prompt} ${QUIET_MUSIC_PROMPT}`, generated: true } } });
    });
  }
}
