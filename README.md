# Fitness Trainer PWA

A voice-guided posture correction and hyoid muscle training app — all exercises in one page, no backend required.

Built for personal use. Runs in any browser, installable as a PWA on phone/tablet/desktop.

## Features

- **8 exercises** across 3 categories: posture correction, hyoid muscle, auxiliary
- **Universal training engine** — 3 modes: counted reps, timed hold, timed reps
- **Voice-guided counting** with pre-generated Qwen3-TTS clips (Chinese, male + female voices)
- **90 BPM background beat** during active training
- **Partial session recording** — cancelled sessions still save progress
- **History panel** with per-day breakdown and CSV export
- **PWA** — installable, offline-capable via Service Worker
- **Responsive** — desktop, tablet, phone (iOS Light Theme)

## Quick Start

```bash
cd fitness-trainer
py serve.py
# → http://localhost:8766/app/index.html
```

Requires Python 3. No npm, no build step.

## Exercises

| # | Name | Mode | Sets × Reps/Hold | Rest |
|---|------|------|-------------------|------|
| 1 | 靠墙天使 Wall Angel | counted_reps | 3 × 20 @ 1.5s | 30s |
| 2 | Shaker · 抬头不动 | timed_hold | 3 × 30s | 60s |
| 3 | Shaker · 连续抬放 | counted_reps | 1 × 30 @ 3s | — |
| 4 | 下颌推压 | timed_hold | 10 × 10s | 5s |
| 5 | FESM 前额等长抗阻 | timed_reps | 5 × 10 @ 5s | 15s |
| 6 | Chin Tuck 收下巴 | timed_reps | 1 × 20 @ 5s | — |
| 7 | Mewing 舌位训练 | habit | — | — |
| 8 | 颏下综合训练 | habit | — | — |

## Project Structure

```
fitness-trainer/
├── app/
│   ├── index.html            # Entry point
│   ├── style.css             # iOS Light Theme
│   ├── manifest.json         # PWA manifest
│   ├── sw.js                 # Service Worker (offline cache)
│   ├── icons/
│   └── js/
│       ├── app.js            # UI + routing
│       ├── engine.js         # Training state machine
│       ├── exercises.js      # Exercise config registry
│       ├── store.js          # localStorage persistence
│       ├── voice.js          # Web Audio playback + silence trimming
│       └── bgm.js            # Background beat generator
├── trainer_tts/              # Wall Angel TTS clips (male voice)
├── hyoid_tts/                # Hyoid exercise TTS clips (female voice)
├── serve.py                  # Dev server (port 8766)
├── DEPLOY.md                 # Deployment guide
└── .gitignore
```

## Architecture

**Training Engine** (`engine.js`) is a state machine with phases:

```
idle → prep → active → rest → (repeat sets) → done
```

Each exercise is a config object in `exercises.js`. The engine reads the config and drives the entire session — voice cues, timers, rep counting, rest periods — without exercise-specific code.

**Voice System** (`voice.js`) loads pre-generated WAV files from `trainer_tts/` and `hyoid_tts/`, with automatic silence trimming for number clips. Falls back to Web Speech API if WAV files are unavailable.

**Data** is stored in `localStorage`, keyed by date. Each session records sets, reps, hold time, duration, and whether it completed or was cancelled.

## Deployment

See [DEPLOY.md](DEPLOY.md) for full instructions.

**Short version:** Cloudflare Pages (free) for the app, Cloudflare R2 (free tier) for video assets, optional Supabase for cross-device sync.

## Tech Stack

- Vanilla JS (ES Modules) — zero dependencies, no build
- Web Audio API — voice playback
- Web Speech API — TTS fallback
- localStorage — offline-first data
- Service Worker — cache-first strategy

## License

Personal project. Not open source.
