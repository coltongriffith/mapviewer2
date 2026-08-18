#!/usr/bin/env python3
import json
import os
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro import KPipeline

SAMPLE_RATE = 24000
VOICE = "af_heart"
SPEED = 0.97
OUTPUT_DIR = Path(os.environ.get("VOICE_OUTPUT_DIR", "tutorial-output"))
CUES_PATH = OUTPUT_DIR / "narration-cues.json"
VOICE_DIR = OUTPUT_DIR / "voice"
VOICE_DIR.mkdir(parents=True, exist_ok=True)

with CUES_PATH.open("r", encoding="utf-8") as handle:
    cues = json.load(handle)

pipeline = KPipeline(lang_code="a")
rendered = []

for index, cue in enumerate(cues, start=1):
    chunks = []
    for _, _, audio in pipeline(
        cue["spokenText"],
        voice=VOICE,
        speed=SPEED,
        split_pattern=r"\n+",
    ):
        samples = np.asarray(audio, dtype=np.float32)
        if samples.size:
            chunks.append(samples)

    if not chunks:
        raise RuntimeError(f"No speech generated for cue {index}")

    gap = np.zeros(int(SAMPLE_RATE * 0.07), dtype=np.float32)
    cue_audio = chunks[0]
    for chunk in chunks[1:]:
        cue_audio = np.concatenate((cue_audio, gap, chunk))

    fade = min(int(SAMPLE_RATE * 0.025), cue_audio.size // 4)
    if fade:
        cue_audio[:fade] *= np.linspace(0.0, 1.0, fade, dtype=np.float32)
        cue_audio[-fade:] *= np.linspace(1.0, 0.0, fade, dtype=np.float32)

    cue_path = VOICE_DIR / f"{index:02d}.wav"
    sf.write(cue_path, cue_audio, SAMPLE_RATE, subtype="PCM_16")
    rendered.append((cue, cue_audio))
    print(
        f"Cue {index:02d}: {cue['atMs'] / 1000:.2f}s, "
        f"{cue_audio.size / SAMPLE_RATE:.2f}s — {cue['spokenText']}"
    )

for index, ((cue, audio), next_item) in enumerate(
    zip(rendered, rendered[1:]), start=1
):
    cue_end_ms = cue["atMs"] + round(audio.size * 1000 / SAMPLE_RATE)
    next_start_ms = next_item[0]["atMs"]
    if cue_end_ms > next_start_ms - 80:
        raise RuntimeError(
            f"Cue {index} ends at {cue_end_ms}ms, too close to "
            f"cue {index + 1} at {next_start_ms}ms"
        )

total_samples = max(
    round(cue["atMs"] * SAMPLE_RATE / 1000) + audio.size
    for cue, audio in rendered
) + SAMPLE_RATE
voiceover = np.zeros(total_samples, dtype=np.float32)

for cue, audio in rendered:
    start = round(cue["atMs"] * SAMPLE_RATE / 1000)
    voiceover[start:start + audio.size] += audio

peak = float(np.max(np.abs(voiceover)))
if peak > 0.94:
    voiceover *= 0.94 / peak

output_path = OUTPUT_DIR / "voiceover-natural.wav"
sf.write(output_path, voiceover, SAMPLE_RATE, subtype="PCM_16")
print(f"Saved {output_path}")
