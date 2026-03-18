# Fitness Trainer PWA

A voice-guided posture correction training app — all exercises in one page, cross-device sync, installable as PWA.

Built for personal use. Runs in any browser on PC / phone / tablet.

## Live

GitHub Pages: `https://jadelin26.github.io/fitness-trainer/`

## Features

- **15 exercises** across 6 categories with per-exercise anatomical icons
- **Universal training engine** — 3 modes: counted reps, timed hold, timed reps
- **Voice-guided counting** with pre-recorded WAV clips (all voice prompts use WAV, no browser TTS dependency)
- **Left/right alternating** — automatic voice prompts ("左腿"/"右腿") for exercises that switch legs per set
- **90 BPM background beat** during Wall Angel training
- **Cloud sync** via Supabase (PostgreSQL) — localStorage as local layer, REST API for sync
- **Calorie tracking** — real-time daily calorie burn on home page with fun equivalents (steps, eggs, lattes, rice bowls)
- **Weight tracking** — dedicated weight page with input, BMI calculation, trend chart, and history log
- **Stats panel** — weekly heatmap, weekly calorie summary, category summaries, per-day session detail, CSV export
- **Progress tracking** — pie-chart progress rings, completion percentage, daily target support
- **Grouping modes** — switch between "by body part" and "by scene/position"
- **PWA** — installable, offline-capable via Service Worker
- **Responsive** — desktop + mobile (iOS Light Theme)

## Quick Start

```bash
cd fitness-trainer
py serve.py
# → http://localhost:8766/app/index.html
```

Requires Python 3. No npm, no build step.

## Exercises

### 头前倾矫正
| Name | Mode | Sets × Reps/Hold | Daily Target |
|------|------|-------------------|-------------|
| 靠墙天使 Wall Angel | counted_reps | 3 × 20 @ 1.5s | 360/day |

### 舌骨肌群
| Name | Mode | Sets × Reps/Hold |
|------|------|-------------------|
| Shaker · 抬头不动 | timed_hold | 3 × 30s |
| Shaker · 连续抬放 | counted_reps | 1 × 30 @ 3s |
| 下颌推压 | timed_hold | 10 × 10s |
| FESM 前额等长抗阻 | timed_reps | 5 × 10 @ 5s |

### 姿势矫正
| Name | Mode |
|------|------|
| Chin Tuck 收下巴 | timed_reps 1 × 20 @ 5s |
| Mewing 舌位训练 | checklist (habit) |

### 辅助训练
| Name | Mode |
|------|------|
| 颏下综合训练 | checklist |

### 骨盆前倾矫正
| Name | Mode | Sets × Reps/Hold | Alternating |
|------|------|-------------------|-------------|
| 俯卧位腰椎呼吸 | timed_hold | 1 × 120s | — |
| 仰卧屈膝骨盆后倾 | counted_reps | 1 × 15 @ 3s | — |
| 单膝跪位髋伸展 | timed_hold | 6 × 15s | ✓ L/R |
| 仰卧单腿下落 | counted_reps | 6 × 10 @ 3s | ✓ L/R |
| 单腿臀桥 | counted_reps | 6 × 15 @ 2s | ✓ L/R |
| 简化版单腿硬拉 | counted_reps | 6 × 15 @ 3s | ✓ L/R |

### 圆肩驼背矫正
| Name | Mode | Duration |
|------|------|----------|
| 弹力带练背 | checklist | ~20 min |

## Project Structure

```
fitness-trainer/
├── app/
│   ├── index.html            # Entry point
│   ├── style.css             # iOS Light Theme, responsive
│   ├── manifest.json         # PWA manifest
│   ├── sw.js                 # Service Worker (offline cache)
│   ├── icons/                # Per-exercise anatomical PNG icons (128×128)
│   └── js/
│       ├── app.js            # UI rendering, stats, weight page, calorie calc
│       ├── engine.js         # Training state machine (prep → active → rest → done)
│       ├── exercises.js      # Exercise config registry (all 15 exercises)
│       ├── store.js          # localStorage + Supabase sync + weight tracking
│       ├── voice.js          # Web Audio playback + silence trimming
│       └── bgm.js            # Background beat generator (Web Audio oscillator)
├── trainer_tts/              # Wall Angel TTS clips (male voice)
├── hyoid_tts/                # General exercise TTS clips (female voice) + left_leg/right_leg
├── videos/                   # Exercise demo videos
├── serve.py                  # Dev server (port 8766)
├── DEPLOY.md                 # Deployment guide
└── .gitignore
```

## Architecture

**Training Engine** (`engine.js`) — state machine:
```
idle → prep → active → rest → (repeat sets) → done
```
Supports 3 modes: `counted_reps`, `timed_hold`, `timed_reps`. Handles left/right alternating via `alternating` property with pre-recorded WAV prompts. Each exercise is a config object — the engine is mode-driven, not exercise-specific.

**Exercise Config** (`exercises.js`) — each exercise defines: id, name, category, scene, mode, defaults (sets/reps/hold/tempo/rest), TTS directory, alternating flag, daily target, video references.

**Voice System** (`voice.js`) — loads pre-recorded WAV files from TTS directories with automatic silence trimming. All voice prompts (numbers, set announcements, left/right leg) use WAV files.

**Data Layer** (`store.js`) — localStorage as primary store, Supabase PostgreSQL as cloud sync. Uses native `fetch()` against Supabase REST API (zero SDK dependency). Also handles weight tracking with timestamped records.

**Calorie Tracking** — MET-based calculation per exercise using actual body weight from weight records. Displayed on home page with fun equivalents and weekly summary in stats panel.

**Weight Tracking** — dedicated page with input, BMI calculation (fixed profile: 163cm/28F), Canvas-drawn trend chart, and deletable history log.

**Stats Panel** — weekly calorie banner, heatmap with area-based completion visualization, category-grouped summaries, per-day session detail log with daily calories, CSV export.

## Deployment

- **Hosting**: GitHub Pages (public repo, free)
- **Database**: Supabase free tier (PostgreSQL + REST API)
- **Domain**: `jadelin26.github.io/fitness-trainer/`

See [DEPLOY.md](DEPLOY.md) for setup details.

## Tech Stack

- Vanilla JS (ES Modules) — zero dependencies, no build
- Web Audio API — voice playback + BGM generation
- Canvas API — weight trend chart
- localStorage + Supabase REST — offline-first with cloud sync
- Service Worker — cache-first strategy
- CSS custom properties — iOS Light Theme

## License

Personal project. Not open source.
