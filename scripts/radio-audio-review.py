"""Review actual audio inputs without exposing credentials or base64 payloads."""
import base64
import json
import os
from pathlib import Path
import sys
import urllib.request

output = Path(sys.argv[1])
paths = [Path(p) for p in sys.argv[2:]]
if not paths or len(paths) > 6:
    raise SystemExit("Supply one to six short MP3 clips")
content = [{"type": "text", "text": "Listen critically to the actual attached audio. This is sound design QA for friendly, family-suitable German/Turkish car-showroom radio. Describe concretely the audible instruments, attack, rhythm, energy, harshness, ending and any silence or unwanted voice. The heard_description field must contain a specific description of what is actually audible, not a boolean. Do not infer sound from filenames. If unable to perceive audio, say so. For multiple clips, compare them. Prefer energetic but tasteful, short, musically resolved radio closers, no alarm-like beeps, no long ambient wash, no harsh percussion. If clips include speech, transcribe the closing words, assess native pronunciation and whether music overlaps any spoken syllable. Return concise JSON with clips:[{file,heard_description,energy_1_to_5,harshness_1_to_5,ending,transcript,musicUnderSpeech,transitionGap,issues,suitable}], preferred, rationale. No claim about legal broadcast clearance."}]
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
