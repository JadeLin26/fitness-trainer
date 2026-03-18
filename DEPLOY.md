# 体态训练 — 部署指南

## 架构概览

```
┌──────────────┐    ┌──────────────────┐    ┌──────────────┐
│  浏览器 PWA  │◄──►│ Cloudflare Pages  │    │ Cloudflare R2│
│  (任何设备)  │    │  (静态站点托管)   │    │  (视频存储)  │
└──────┬───────┘    └──────────────────┘    └──────────────┘
       │
       ▼
┌──────────────┐
│   Supabase   │
│  (数据同步)  │
└──────────────┘
```

## 费用：$0/月

| 服务 | 免费额度 | 我们用量 |
|------|---------|---------|
| Cloudflare Pages | 500次构建/月，无限带宽 | <10次构建/月 |
| Cloudflare R2 | 10GB存储，免流出费 | ~100MB |
| Supabase | 500MB数据库，50K月活用户 | <1MB，1用户 |

---

## Step 1：创建 GitHub 仓库

```bash
cd f:\BaiduSyncdisk\个人开发\健身记录
git init
git add app/ trainer_tts/ hyoid_tts/ serve.py DEPLOY.md
git commit -m "initial: fitness training PWA"
git remote add origin https://github.com/YOUR_USERNAME/fitness-trainer.git
git push -u origin main
```

**注意**：`videos/` 文件夹不要推到 GitHub（太大），后面用 R2 托管。

在 `.gitignore` 中加入：
```
videos/
*.xlsx
*.pyw
__pycache__/
```

---

## Step 2：Cloudflare Pages 部署

1. 注册 [Cloudflare](https://dash.cloudflare.com) 账号（免费）
2. 进入 **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
3. 选择你的 GitHub 仓库
4. 构建设置：
   - **Build command**: 留空（纯静态站点）
   - **Build output directory**: `/`（根目录）
5. 点击 **Save and Deploy**
6. 部署完成后会得到一个 `xxx.pages.dev` 的网址

之后每次 `git push`，Cloudflare 会自动重新部署。

---

## Step 3：Cloudflare R2 视频存储

1. 在 Cloudflare 控制台 → **R2 Object Storage** → **Create bucket**
2. 桶名：`fitness-videos`
3. 进入桶 → **Settings** → **Public Access** → 开启公开访问
4. 上传 `videos/` 下的 6 个 MP4 文件（控制台拖拽上传即可）
5. 上传后每个文件会有一个公开 URL，格式：
   `https://pub-xxxxx.r2.dev/shaker.mp4`
6. 修改 `app/js/exercises.js` 中的 `video` 字段为 R2 URL：
   ```javascript
   video: 'https://pub-xxxxx.r2.dev/shaker_iso.mp4',
   ```

---

## Step 4：Supabase 数据同步（可选，跨设备同步时启用）

### 4.1 创建项目
1. 注册 [Supabase](https://supabase.com)（免费）
2. 创建新项目，区域选 **Southeast Asia (Singapore)**（离中国最近）
3. 记录 Project URL 和 anon key

### 4.2 建表

在 Supabase SQL Editor 中执行：

```sql
-- 训练记录
CREATE TABLE training_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  device_id TEXT NOT NULL,
  training_day DATE NOT NULL,
  exercise_id TEXT NOT NULL,
  time TEXT,
  sets INT,
  reps_per_set INT,
  total_reps INT DEFAULT 0,
  hold_seconds INT DEFAULT 0,
  duration_seconds INT DEFAULT 0,
  session_kind TEXT DEFAULT '完成',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 每日打卡
CREATE TABLE daily_checklist (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  device_id TEXT NOT NULL,
  training_day DATE NOT NULL,
  exercise_id TEXT NOT NULL,
  checked_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(device_id, training_day, exercise_id)
);

-- 索引
CREATE INDEX idx_sessions_day ON training_sessions(training_day);
CREATE INDEX idx_sessions_device ON training_sessions(device_id);
CREATE INDEX idx_checklist_day ON daily_checklist(training_day);

-- RLS（行级安全）— 个人使用，允许所有操作
ALTER TABLE training_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_checklist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all" ON training_sessions FOR ALL USING (true);
CREATE POLICY "allow_all" ON daily_checklist FOR ALL USING (true);
```

### 4.3 前端接入

在 `app/js/store.js` 中添加 Supabase SDK：

```html
<!-- index.html 中加入 -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
```

然后在 `store.js` 中添加同步逻辑（写入时同时写 localStorage 和 Supabase，读取时优先本地）。

---

## Step 5：PWA 安装

部署完成后：

- **手机**：用浏览器打开网址 → 点「添加到主屏幕」
- **电脑**：Chrome 地址栏会显示安装图标 → 点击安装为桌面应用

---

## 本地开发

```bash
cd f:\BaiduSyncdisk\个人开发\健身记录
py serve.py
# 浏览器打开 http://localhost:8766/app/index.html
```

---

## 文件结构

```
健身记录/
├── app/                    # 前端应用（部署到 Cloudflare Pages）
│   ├── index.html
│   ├── style.css
│   ├── manifest.json
│   ├── sw.js               # Service Worker
│   ├── icons/
│   │   └── icon-512.png
│   └── js/
│       ├── app.js           # 主逻辑 + UI
│       ├── engine.js        # 训练引擎状态机
│       ├── exercises.js     # 训练配置注册表
│       ├── store.js         # 数据层 (localStorage + Supabase)
│       ├── voice.js         # 语音播放
│       └── bgm.js           # BGM 播放
├── trainer_tts/             # 靠墙天使 TTS WAV (5.3MB)
├── hyoid_tts/               # 舌骨训练 TTS WAV (4MB)
├── videos/                  # 训练视频 (98MB, 上传到 R2)
├── serve.py                 # 本地开发服务器
└── DEPLOY.md                # 本文档
```
