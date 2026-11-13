# CapCatcher Evaluation Harness

This directory contains the dataset, scripts, and results for the rigorous evaluation of CapCatcher.

## Directory Structure
- `capcatcher/labels.json`: Ground truth dataset definition and labels.
- `capcatcher/reels/`: Directory to place the reel video files (`.mp4`).
- `results/`: Raw outputs and metric dumps from evaluation runs.
- `RESULTS.md`: Detailed evaluation report and resume-safe claims.

## Modality Categories (Minimum 10 Reels)
1. **Speech only** (at least 2 reels): Spoken claims with minimal or irrelevant on-screen text.
2. **On-screen text only** (at least 2 reels): Silent or music-only reels where claims are displayed on screen.
3. **Both** (at least 4 reels): Claims present in speech and/or visual overlays.
4. **No checkable claims** (2 reels): Vlogs, comedy, personal opinions, aesthetics with 0 checkable factual claims.

## Verdict Schema
- `true`
- `false`
- `misleading`
- `unverified`

