#!/usr/bin/env python3
import json
import subprocess
from pathlib import Path

ROOT = Path("onboarding-series-output")
MASTER = ROOT / "exploration-maps-complete-onboarding-natural-synced.mp4"
CHAPTERS = ROOT / "chapters"
QA = ROOT / "qa-contact-sheets"
CHAPTERS.mkdir(parents=True, exist_ok=True)
QA.mkdir(parents=True, exist_ok=True)

chapters = json.loads((ROOT / "chapters.json").read_text(encoding="utf-8"))
for chapter in chapters:
    start = chapter["startMs"] / 1000
    duration = (chapter["endMs"] - chapter["startMs"]) / 1000
    target = CHAPTERS / f"{chapter['slug']}-natural-synced.mp4"
    subprocess.run([
        "ffmpeg", "-nostdin", "-y", "-ss", f"{start:.3f}", "-i", str(MASTER),
        "-t", f"{duration:.3f}", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(target),
    ], check=True)

all_videos = [MASTER, *sorted(CHAPTERS.glob("*.mp4"))]
for video in all_videos:
    subprocess.run([
        "ffmpeg", "-nostdin", "-y", "-i", str(video),
        "-vf", "fps=1/8,scale=480:-1,tile=4x3:padding=4:margin=4",
        "-frames:v", "1", str(QA / f"{video.stem}.jpg"),
    ], check=True)

lines = [
    "# Exploration Maps Core Onboarding Videos",
    "",
    "Post-ready onboarding videos covering the complete journey from a first website visit to a downloaded map.",
    "",
    "## Videos",
    "",
    "- **Complete walkthrough:** `exploration-maps-complete-onboarding-natural-synced.mp4`",
]
for chapter in chapters:
    lines.append(f"- **{chapter['title']}:** `chapters/{chapter['slug']}-natural-synced.mp4`")
lines += [
    "",
    "## Posting standard",
    "",
    "- 1440 × 900 MP4",
    "- H.264 video and AAC audio",
    "- Natural Kokoro `af_heart` narration at 0.97 speed",
    "- Narration matches the exact on-screen captions",
    "- Browser actions and chapter boundaries use captured timestamps",
    "- The demonstration email flow is safely intercepted during recording; no test account or email is created",
]
(ROOT / "README.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
