# Fitness Trainer PWA

A single-page Progressive Web App for posture correction training — Wall Angel + Hyoid/Chin exercises, all in one page.

## Features

- **8 exercises** across two categories: forward head correction and hyoid muscle training
- **Universal training engine** with three modes: counted reps, timed hold, timed reps
- **Voice-guided counting** using pre-generated Qwen3-TTS WAV clips (Chinese)
- **Background beat** at 90 BPM during training
- **Progress tracking** with localStorage (offline-first)
- **History panel** with per-session detail and CSV export
- **PWA support** — installable, offline-capable via Service Worker
- **Responsive design** — works on desktop, tablet, and phone (iOS Light Theme style)

## Quick Start

```bash
# Python 3 required
cd fitness-trainer
py serve.py
# Open http://localhost:8766/app/index.html
```

## Exercise List

| # | Exercise | Mode | Config |
|---|----------|------|--------|
| 1 | Wall Angel (靠墙天使) | Counted reps | 3×20, 1.5s/rep, 360/day target |
| 2 | Shaker Isometric (抬头不动) | Timed hold | 3×30s |
| 3 | Shaker Dynamic (连续抬放) | Counted reps | 3×20, 2s/rep |
| 4 | Submental Push (下颌推压) | Timed hold | 5×10s |
| 5 | FESM (前额等长抗阻) | Timed reps | 3×10, 5s/rep |
| 6 | Chin Tuck (收下巴) | Timed reps | 3×10, 5s/rep |
| 7 | Mewing (舌位训练) | Habit | — |
| 8 | Jawline (颏下综合) | Habit | — |

## Project Structure

```
fitness-trainer/
├── app/                   # Frontend SPA
│   ├── index.html         # Entry point
│   ├── style.css          # iOS Light Theme styles
│   ├── manifest.json      # PWA manifest
│   ├── sw.js              # Service Worker
│   ├── icons/             # App icon
│   └── js/
│       ├── app.js         # Main logic + UI
│       ├── engine.js      # Training state machine
│       ├── exercises.js   # Exercise config registry
│       ├── store.js       # localStorage data layer
│       ├── voice.js       # Web Audio API playback
│       └── bgm.js         # Background music
├── trainer_tts/           # Wall Angel TTS clips (~5MB)
├── hyoid_tts/             # Hyoid exercise TTS clips (~4MB)
├── serve.py               # Local dev server (port 8766)
├── DEPLOY.md              # Deployment guide
└── .gitignore
```

## Deployment

See [DEPLOY.md](DEPLOY.md) for full instructions.

**TL;DR:** Cloudflare Pages (free) for the app, Cloudflare R2 (free) for video assets, optional Supabase (free) for cross-device sync.

## Tech Stack

- Vanilla JavaScript (ES Modules), no build step
- Web Audio API for voice playback
- Web Speech API as TTS fallback
- localStorage for data persistence
- Service Worker for offline caching
