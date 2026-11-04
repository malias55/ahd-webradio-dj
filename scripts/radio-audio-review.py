"""Review actual audio inputs without exposing credentials or base64 payloads."""
import base64
import json
import os
from pathlib import Path
import sys
import urllib.request

music = "--music" in sys.argv
transitions = "--transitions" in sys.argv
args = [a for a in sys.argv if a not in ("--music", "--transitions")]
output = Path(args[1])
paths = [Path(p) for p in args[2:]]
if not paths or len(paths) > 6:
    raise SystemExit("Supply one to six short MP3 clips")
content = [{"type": "text", "text": "Listen critically to the actual attached audio. This is sound design QA for friendly, family-suitable German/Turkish car-showroom radio. Describe concretely the audible instruments, attack, rhythm, energy, harshness, ending and any silence or unwanted voice. The heard_description field must contain a specific description of what is actually audible, not a boolean. Do not infer sound from filenames. If unable to perceive audio, say so. For multiple clips, compare them. Prefer energetic but tasteful, short, musically resolved radio closers, no alarm-like beeps, no long ambient wash, no harsh percussion. If clips include speech, transcribe the closing words, assess native pronunciation and whether music overlaps any spoken syllable. Return concise JSON with clips:[{file,heard_description,energy_1_to_5,harshness_1_to_5,ending,transcript,musicUnderSpeech,transitionGap,issues,suitable}], preferred, rationale. No claim about legal broadcast clearance."}]
if music:
    content = [{"type": "text", "text": "Listen critically to these actual music inputs. We are expanding a quiet car-showroom instrumental rotation: refined lounge jazz, ambient jazz and smooth jazz. The reference is an already approved existing track; new tracks should add modest variety while staying warm, optimistic, unobtrusive, suitable for all ages and comfortable under conversation. Each review-N.mp3 contains three seven-second excerpts from the beginning, middle and ending of ONE complete four-minute track; ignore the intentional review-edit cuts between samples. Assess actual audible instruments, vocals or vocal samples (none wanted), pace, energy, harshness, distracting solos, excessive drama/club drops or melancholy. Do not infer from names or assert you heard the whole track. Return concise JSON {tracks:[{file,heard_description,vocals,energy_1_to_5,harshness_1_to_5,suitable,issues,reason}],comparisonToExisting}. If unable to perceive audio say so. The reference file is named existing-reference.mp3 and should not be selected for new publication."}]
if transitions:
    content = [{"type": "text", "text": "Listen critically to the actual attached Turkish radio story-transition excerpts. Assess the audible ending of one story, the interval, and the beginning of the next. Describe what you actually hear: voice clarity, any music/effect/bleep between stories or underneath speech, silence length, abrupt cutoff or missing syllables. Our desired result is a calm natural spoken bulletin with a brief quiet pause between complete stories, no sonic punctuation, no background music, and no clipped words. Do not infer from filenames or pretend to hear unavailable audio. Compare the excerpts and return concise JSON {clips:[{file,heard_description,transitionGap,musicUnderSpeech,soundBetweenStories,clippedSpeech,suitable,issues}],preferred,rationale}. This is only a short excerpt review, not a whole-recording assessment."}]
for path in paths:
    if path.stat().st_size > 2_000_000:
        raise SystemExit("Use short excerpts under 2 MB each")
    content.extend([{"type": "text", "text": "Clip: " + path.name}, {"type": "input_audio", "input_audio": {"data": base64.b64encode(path.read_bytes()).decode(), "format": "mp3"}}])
body = {"model": "gpt-audio-1.5", "modalities": ["text"], "messages": [{"role": "user", "content": content}], "max_completion_tokens": 1600, "store": False}
r = urllib.request.Request("https://api.openai.com/v1/chat/completions", data=json.dumps(body).encode(), headers={"Authorization": "Bearer " + os.environ["OPENAI_API_KEY"], "Content-Type": "application/json"})
try:
    with urllib.request.urlopen(r, timeout=100) as response:
        data = json.load(response)
except urllib.error.HTTPError as error:
    raise SystemExit("Audio review HTTP " + str(error.code))
text = data.get("choices", [{}])[0].get("message", {}).get("content", "")
if not text:
    raise SystemExit("No audio review returned")
result = {"model": data.get("model"), "usage": data.get("usage"), "review": text, "files": [p.name for p in paths]}
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(result, ensure_ascii=False, indent=2))
print(text)
