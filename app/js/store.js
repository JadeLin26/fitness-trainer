// localStorage-based training data store with 6AM day boundary + Supabase cloud sync.

const STORE_KEY = 'fitness_training_data';
const CONFIG_KEY = 'fitness_training_config';
const DEVICE_ID = _getDeviceId();

const SUPABASE_URL = 'https://xdflczptaiptmrwtaoye.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_L_GiFhoO6rV8Rhe70tOivA_8Oorcgaa';

let _sb = null;
function _supabase() {
  if (_sb) return _sb;
  if (typeof window.supabase !== 'undefined') {
    _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return _sb;
}

function _getDeviceId() {
  let id = localStorage.getItem('fitness_device_id');
  if (!id) {
    id = crypto.randomUUID?.() || Math.random().toString(36).slice(2);
    localStorage.setItem('fitness_device_id', id);
  }
  return id;
}

function _trainingDay(now = new Date()) {
  const d = new Date(now);
  if (d.getHours() < 6) d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
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
  const sb = _supabase();
  if (!sb) return;
  try {
    await sb.from('training_sessions').insert({
      device_id: DEVICE_ID,
      training_day: day,
      exercise_id: exerciseId,
      time: entry.time,
      sets: entry.sets || null,
      reps_per_set: entry.repsPerSet || null,
      total_reps: entry.totalReps || 0,
      hold_seconds: entry.holdSeconds || 0,
      duration_seconds: entry.durationSeconds || 0,
      session_kind: entry.sessionKind || '完成',
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
  const sb = _supabase();
  if (!sb) return;
  try {
    await sb.from('daily_checklist').upsert({
      device_id: DEVICE_ID,
      training_day: day,
      exercise_id: exerciseId,
    }, { onConflict: 'device_id,training_day,exercise_id' });
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

// Pull cloud data and merge into localStorage on startup
export async function syncFromCloud() {
  const sb = _supabase();
  if (!sb) return;
  try {
    const { data: sessions } = await sb
      .from('training_sessions')
      .select('*')
      .order('created_at', { ascending: true });

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

    const { data: checks } = await sb
      .from('daily_checklist')
      .select('*');

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
