// localStorage-based training data store with 6AM day boundary + Supabase cloud sync via REST API.

const STORE_KEY = 'fitness_training_data';
const CONFIG_KEY = 'fitness_training_config';
const DEVICE_ID = _getDeviceId();

const SB_URL = 'https://xdflczptaiptmrwtaoye.supabase.co/rest/v1';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkZmxjenB0YWlwdG1yd3Rhb3llIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4NTkxNDcsImV4cCI6MjA4OTQzNTE0N30.df1tan5GOwfiauVqgManHpkxc24m7nPcPcLGJrXnk2M';
const SB_HEADERS = {
  'apikey': SB_KEY,
  'Authorization': `Bearer ${SB_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=minimal',
};

function _getDeviceId() {
  let id = localStorage.getItem('fitness_device_id');
  if (!id) {
    id = crypto.randomUUID?.() || Math.random().toString(36).slice(2);
    localStorage.setItem('fitness_device_id', id);
  }
  return id;
}

function _localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _trainingDay(now = new Date()) {
  const d = new Date(now);
  if (d.getHours() < 6) d.setDate(d.getDate() - 1);
  return _localDateStr(d);
}

function _load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
  catch { return {}; }
}

function _save(data) {
  localStorage.setItem(STORE_KEY, JSON.stringify(data));
}

export function trainingDay(now) { return _trainingDay(now); }

export function recordSession(exerciseId, { sets, repsPerSet, totalReps, holdSeconds, durationSeconds, sessionKind }) {
  const data = _load();
  const now = new Date();
  const day = _trainingDay(now);
  if (!data[day]) data[day] = {};
  if (!data[day][exerciseId]) data[day][exerciseId] = [];
  const entry = {
    time: now.toTimeString().slice(0, 5),
    sets, repsPerSet, totalReps, holdSeconds, durationSeconds, sessionKind,
    ts: now.toISOString(),
  };
  data[day][exerciseId].push(entry);
  _save(data);

  _syncSessionToCloud(day, exerciseId, entry);
}

async function _syncSessionToCloud(day, exerciseId, entry) {
  try {
    await fetch(`${SB_URL}/training_sessions`, {
      method: 'POST',
      headers: SB_HEADERS,
      body: JSON.stringify({
        device_id: DEVICE_ID,
        training_day: day,
        exercise_id: exerciseId,
        time: entry.time,
        sets: entry.sets || null,
        reps_per_set: entry.repsPerSet || null,
        total_reps: entry.totalReps || 0,
        hold_seconds: entry.holdSeconds || 0,
        duration_seconds: entry.durationSeconds || 0,
        session_kind: entry.sessionKind || 'done',
        created_at: new Date().toISOString(),
      }),
    });
  } catch (e) {
    console.warn('Supabase sync failed:', e);
  }
}

export function getDaySessions(exerciseId, day) {
  const data = _load();
  return (data[day] || {})[exerciseId] || [];
}

export function getDayTotalReps(exerciseId, day) {
  return getDaySessions(exerciseId, day).reduce((s, e) => s + (e.totalReps || 0), 0);
}

export function getDayTotalHoldSec(exerciseId, day) {
  return getDaySessions(exerciseId, day).reduce((s, e) => s + (e.holdSeconds || 0), 0);
}

export function getDaySessionCount(exerciseId, day) {
  return getDaySessions(exerciseId, day).length;
}

export function getAllDays() {
  return Object.keys(_load()).sort();
}

export function markChecked(exerciseId, day) {
  const key = `fitness_check_${day}`;
  const checks = JSON.parse(localStorage.getItem(key) || '{}');
  checks[exerciseId] = new Date().toISOString();
  localStorage.setItem(key, JSON.stringify(checks));

  _syncCheckToCloud(day, exerciseId);
}

async function _syncCheckToCloud(day, exerciseId) {
  try {
    await fetch(`${SB_URL}/daily_checklist`, {
      method: 'POST',
      headers: { ...SB_HEADERS, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        device_id: DEVICE_ID,
        training_day: day,
        exercise_id: exerciseId,
        checked_at: new Date().toISOString(),
      }),
    });
  } catch (e) {
    console.warn('Supabase check sync failed:', e);
  }
}

export function isChecked(exerciseId, day) {
  const key = `fitness_check_${day}`;
  const checks = JSON.parse(localStorage.getItem(key) || '{}');
  return !!checks[exerciseId];
}

export function getConfig() {
  try { return JSON.parse(localStorage.getItem(CONFIG_KEY)) || {}; }
  catch { return {}; }
}

export function setConfig(cfg) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

export function exportCSV() {
  const data = _load();
  const rows = ['日期,训练ID,时间,组数,每组次数,总次数,保持秒数,用时秒,类型'];
  for (const [day, exs] of Object.entries(data)) {
    for (const [exId, sessions] of Object.entries(exs)) {
      for (const s of sessions) {
        rows.push([day, exId, s.time, s.sets||'', s.repsPerSet||'', s.totalReps||'', s.holdSeconds||'', s.durationSeconds||'', s.sessionKind||''].join(','));
      }
    }
  }
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `fitness_log_${_trainingDay()}.csv`;
  a.click();
}

// --- Weight tracking ---
const WEIGHT_KEY = 'fitness_weight_log';
const PROFILE = { heightCm: 163, age: 28, sex: 'female' };

function _loadWeights() {
  try { return JSON.parse(localStorage.getItem(WEIGHT_KEY)) || []; }
  catch { return []; }
}

export function recordWeight(kg) {
  const log = _loadWeights();
  log.push({ kg, ts: new Date().toISOString() });
  localStorage.setItem(WEIGHT_KEY, JSON.stringify(log));
}

export function getWeightLog() {
  return _loadWeights();
}

export function getLatestWeight() {
  const log = _loadWeights();
  return log.length ? log[log.length - 1].kg : null;
}

export function calcBMI(kg) {
  const hm = PROFILE.heightCm / 100;
  return kg / (hm * hm);
}

export function getProfile() {
  return PROFILE;
}

export async function syncFromCloud() {
  try {
    const res = await fetch(`${SB_URL}/training_sessions?order=created_at.asc`, {
      headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` },
    });
    if (!res.ok) return;
    const sessions = await res.json();

    if (sessions?.length) {
      const local = _load();
      let merged = false;
      for (const s of sessions) {
        const day = s.training_day;
        const exId = s.exercise_id;
        if (!local[day]) local[day] = {};
        if (!local[day][exId]) local[day][exId] = [];
        const exists = local[day][exId].some(e => e.ts && s.created_at && e.ts.slice(0, 16) === s.created_at.slice(0, 16));
        if (!exists) {
          local[day][exId].push({
            time: s.time,
            sets: s.sets,
            repsPerSet: s.reps_per_set,
            totalReps: s.total_reps,
            holdSeconds: s.hold_seconds,
            durationSeconds: s.duration_seconds,
            sessionKind: s.session_kind,
            ts: s.created_at,
          });
          merged = true;
        }
      }
      if (merged) _save(local);
    }

    const res2 = await fetch(`${SB_URL}/daily_checklist`, {
      headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` },
    });
    if (!res2.ok) return;
    const checks = await res2.json();

    if (checks?.length) {
      for (const c of checks) {
        const key = `fitness_check_${c.training_day}`;
        const local = JSON.parse(localStorage.getItem(key) || '{}');
        if (!local[c.exercise_id]) {
          local[c.exercise_id] = c.checked_at;
          localStorage.setItem(key, JSON.stringify(local));
        }
      }
    }
  } catch (e) {
    console.warn('Cloud sync pull failed:', e);
  }
}
