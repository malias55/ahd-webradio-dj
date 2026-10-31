import { naturalRadioText } from "./presentation";
import { assertFamilyContent } from "./family";
import { speechText } from "./pronunciation";
import { prisma } from "../prisma";
import { normalizeAudio, withJob } from "./store";
import { stationTime } from "./config";
import { elevenLabsError } from "./elevenlabs";

export function presenterForSlot(slot: Date) {
  return presenterForHour(stationTime(slot).hour);
}
export function presenterForHour(hour: number) {
  if (hour === 7) return { gender: "male" as const, name: "Cavit", language: "tr" as const, voiceId: process.env.ELEVENLABS_TURKISH_VOICE_ID || "Q2IX97JeHBY3vNGzgM5s", assistant: "yapay zekâ haber sunucunuz" };
  return { gender: "male" as const, name: "Elias", language: "de" as const, voiceId: process.env.ELEVENLABS_MALE_VOICE_ID || "1h6gHcRvQugDNZgdAo9N", assistant: "Ihr KI-Nachrichtenassistent" };
}
export function servicePresenter() {
  return { gender: "female" as const, name: process.env.ELEVENLABS_SERVICE_VOICE_NAME || "Susanne", language: "de" as const, voiceId: process.env.ELEVENLABS_SERVICE_VOICE_ID || "mjTSjCqHhkhULvdsy68o", assistant: "Ihre KI-Moderatorin für Wetter und Verkehr" };
}

export function composeMusic(prompt: string, seconds: number) {
  return eleven("/v1/music?output_format=mp3_44100_128", {
    prompt, music_length_ms: Math.round(seconds * 1000), model_id: process.env.ELEVENLABS_MUSIC_MODEL || "music_v2", force_instrumental: true,
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
export const SERVICE_VOICE_SETTINGS = { stability: 0.4, similarity_boost: 0.75, style: 0.15, speed: 1.06, use_speaker_boost: true };
export async function speech(text: string, voiceId: string, language: "de" | "tr" = "de", delivery: SpeechDelivery = "standard") {
  assertFamilyContent(text);
  const spoken = naturalRadioText(text);
  if (!spoken) throw new Error("Kein verwendbarer Radiotext");
  return eleven(`/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    text: speechText(spoken, language), model_id: process.env.ELEVENLABS_TTS_MODEL || "eleven_multilingual_v2", language_code: language,
    voice_settings: delivery === "service" ? SERVICE_VOICE_SETTINGS : { stability: 0.65, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true },
  });
}

export { editorialJson as edenJson, newsModelConfig, editorialConfigured, type ModelCall } from "./models";

export const MUSIC_STYLES = [
  { title: "Showroom Velvet", prompt: "Refined instrumental lounge for a welcoming car showroom. Warm Rhodes piano, soft electronic groove, tasteful jazz harmonies, rounded bass, brushed percussion, 92 BPM. Elegant, optimistic and relaxed. No vocals, no dramatic drops, no aggressive drums." },
  { title: "Velvet Floorplan", prompt: "Airy instrumental ambient jazz for a premium car showroom. Gentle felt piano, warm acoustic bass, soft brushes, subtle atmospheric pads, 82 BPM. Bright, comfortable and unobtrusive, quietly confident. No vocals, no melancholy, no dramatic tension." },
  { title: "Showroom Satin", prompt: "Sophisticated instrumental smooth jazz for a friendly car showroom. Mellow clean guitar, warm electric piano, tasteful bass and understated drums, 98 BPM. Positive, sunny and polished. No vocals, no solo virtuosity, no loud peaks." },
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
      const raw = await eleven("/v1/music?output_format=mp3_44100_128", {
        prompt: style.prompt, music_length_ms: 180_000, model_id: process.env.ELEVENLABS_MUSIC_MODEL || "music_v2", force_instrumental: true,
      }, 360_000);
      const audio = await normalizeAudio(raw, 240);
      await prisma.radioAsset.create({ data: { key, kind: "music", title: `${style.title} ${batch + 1}`, ...audio, metadata: { prompt: style.prompt, generated: true } } });
    });
  }
}
