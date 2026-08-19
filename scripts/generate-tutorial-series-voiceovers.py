#!/usr/bin/env python3
import json
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro import KPipeline

SAMPLE_RATE = 24000
VOICE = "af_heart"
SPEED = 0.97
ROOT = Path("tutorial-series-output")

pipeline = KPipeline(lang_code="a")

for cue_path in sorted(ROOT.glob("*/narration-cues.json")):
    output_dir = cue_path.parent
    voice_dir = output_dir / "voice"
    voice_dir.mkdir(parents=True, exist_ok=True)
    cues = json.loads(cue_path.read_text(encoding="utf-8"))
    rendered = []

    for index, cue in enumerate(cues, start=1):
        chunks = []
        for _, _, audio in pipeline(
            cue["spokenText"], voice=VOICE, speed=SPEED, split_pattern=r"\n+"
        ):
            samples = np.asarray(audio, dtype=np.float32)
            if samples.size:
                chunks.append(samples)
        if not chunks:
            raise RuntimeError(f"No speech generated for {output_dir.name} cue {index}")

        gap = np.zeros(int(SAMPLE_RATE * 0.07), dtype=np.float32)
        cue_audio = chunks[0]
        for chunk in chunks[1:]:
            cue_audio = np.concatenate((cue_audio, gap, chunk))

        fade = min(int(SAMPLE_RATE * 0.025), cue_audio.size // 4)
        if fade:
            cue_audio[:fade] *= np.linspace(0.0, 1.0, fade, dtype=np.float32)
            cue_audio[-fade:] *= np.linspace(1.0, 0.0, fade, dtype=np.float32)

        sf.write(voice_dir / f"{index:02d}.wav", cue_audio, SAMPLE_RATE, subtype="PCM_16")
        rendered.append((cue, cue_audio))
        print(
            f"{output_dir.name} cue {index:02d}: {cue['atMs']/1000:.2f}s, "
            f"{cue_audio.size/SAMPLE_RATE:.2f}s — {cue['spokenText']}"
        )

    for index, ((cue, audio), next_item) in enumerate(zip(rendered, rendered[1:]), start=1):
        cue_end_ms = cue["atMs"] + round(audio.size * 1000 / SAMPLE_RATE)
        next_start_ms = next_item[0]["atMs"]
        if cue_end_ms > next_start_ms - 80:
            raise RuntimeError(
                f"{output_dir.name} cue {index} ends at {cue_end_ms}ms, "
                f"too close to cue {index + 1} at {next_start_ms}ms"
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
    sf.write(output_dir / "voiceover-natural.wav", voiceover, SAMPLE_RATE, subtype="PCM_16")
    print(f"Saved {output_dir / 'voiceover-natural.wav'}")

