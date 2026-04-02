// localStorage-based training data store with 6AM day boundary + Supabase cloud sync via REST API.
// Multi-user: URL hash selects user profile (e.g. #b1). All storage keys are prefixed per user.

const USER_ID = (location.hash || '').replace('#', '').toLowerCase() || 'default';
const _pfx = USER_ID === 'default' ? '' : `${USER_ID}_`;

const STORE_KEY = `${_pfx}fitness_training_data`;
const CONFIG_KEY = `${_pfx}fitness_training_config`;
const DEVICE_ID = _getDeviceId();

export function getUserId() { return USER_ID; }

const SB_URL = 'https://xdflczptaiptmrwtaoye.supabase.co/rest/v1';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkZmxjenB0YWlwdG1yd3Rhb3llIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4NTkxNDcsImV4cCI6MjA4OTQzNTE0N30.df1tan5GOwfiauVqgManHpkxc24m7nPcPcLGJrXnk2M';
const SB_HEADERS = {
  'apikey': SB_KEY,
  'Authorization': `Bearer ${SB_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=minimal',
};

function _getDeviceId() {
  const key = `${_pfx}fitness_device_id`;
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID?.() || Math.random().toString(36).slice(2);
    localStorage.setItem(key, id);
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

// One-time migration: fix dates stored with wrong timezone due to toISOString() UTC bug
function _migrateTimezoneDates() {
  const MIG_KEY = `${_pfx}fitness_migration_tz_v1`;
  if (localStorage.getItem(MIG_KEY)) return;

  // Fix training_data
  const data = _load();
  const fixed = {};
  let moved = 0;
  for (const [day, exs] of Object.entries(data)) {
    for (const [exId, sessions] of Object.entries(exs)) {
      for (const s of sessions) {
        let correctDay = day;
        if (s.ts) {
          const d = new Date(s.ts);
          if (!isNaN(d)) correctDay = _trainingDay(d);
        }
        if (!fixed[correctDay]) fixed[correctDay] = {};
        if (!fixed[correctDay][exId]) fixed[correctDay][exId] = [];
        fixed[correctDay][exId].push(s);
        if (correctDay !== day) moved++;
      }
    }
  }
  if (moved) {
    _save(fixed);
    console.log(`[migration] Moved ${moved} session(s) to correct dates`);
  }

  // Fix checklist keys
  const checkKeys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(`${_pfx}fitness_check_`)) checkKeys.push(k);
  }
  for (const key of checkKeys) {
    const oldDay = key.slice(`${_pfx}fitness_check_`.length);
    const checks = JSON.parse(localStorage.getItem(key) || '{}');
    const toMove = {};
    for (const [exId, ts] of Object.entries(checks)) {
      if (!ts) continue;
      const d = new Date(ts);
      if (isNaN(d)) continue;
      const correctDay = _trainingDay(d);
      if (correctDay !== oldDay) {
        toMove[exId] = { ts, correctDay };
        moved++;
      }
    }
    for (const [exId, { ts, correctDay }] of Object.entries(toMove)) {
      delete checks[exId];
      const newKey = `${_pfx}fitness_check_${correctDay}`;
      const newChecks = JSON.parse(localStorage.getItem(newKey) || '{}');
      newChecks[exId] = ts;
      localStorage.setItem(newKey, JSON.stringify(newChecks));
    }
    localStorage.setItem(key, JSON.stringify(checks));
  }

  // Fix Supabase cloud data
  _migrateCloudDates();

  localStorage.setItem(MIG_KEY, String(Date.now()));
  if (moved) console.log(`[migration] Timezone date migration complete, ${moved} record(s) fixed`);
}

async function _migrateCloudDates() {
  try {
    const res = await fetch(`${SB_URL}/training_sessions?select=id,training_day,created_at`, {
      headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` },
    });
    if (!res.ok) return;
    const rows = await res.json();
    for (const r of rows) {
      if (!r.created_at) continue;
      const correct = _trainingDay(new Date(r.created_at));
      if (correct !== r.training_day) {
        await fetch(`${SB_URL}/training_sessions?id=eq.${r.id}`, {
          method: 'PATCH',
          headers: SB_HEADERS,
          body: JSON.stringify({ training_day: correct }),
        });
      }
    }

    const res2 = await fetch(`${SB_URL}/daily_checklist?select=id,training_day,checked_at`, {
      headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` },
    });
    if (!res2.ok) return;
    const rows2 = await res2.json();
    for (const r of rows2) {
      if (!r.checked_at) continue;
      const correct = _trainingDay(new Date(r.checked_at));
      if (correct !== r.training_day) {
        await fetch(`${SB_URL}/daily_checklist?id=eq.${r.id}`, {
          method: 'PATCH',
          headers: SB_HEADERS,
          body: JSON.stringify({ training_day: correct }),
        });
      }
    }
    console.log('[migration] Cloud dates fixed');
  } catch (e) {
    console.warn('[migration] Cloud date fix failed:', e);
  }
}

_migrateTimezoneDates();

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
  const key = `${_pfx}fitness_check_${day}`;
  const checks = JSON.parse(localStorage.getItem(key) || '{}');
  checks[exerciseId] = new Date().toISOString();
  localStorage.setItem(key, JSON.stringify(checks));

  _syncCheckToCloud(day, exerciseId);
}

export function incrementCheck(exerciseId, day) {
  recordSession(exerciseId, { totalReps: 1, sessionKind: 'check' });
}

export function getCheckCount(exerciseId, day) {
  return getDaySessions(exerciseId, day).length;
}

export function decrementCheck(exerciseId, day) {
  const data = _load();
  const sessions = (data[day] || {})[exerciseId] || [];
  if (sessions.length === 0) return;
  const removed = sessions.pop();
  _save(data);
  _deleteLastCheckFromCloud(day, exerciseId, removed);
}

async function _deleteLastCheckFromCloud(day, exerciseId, entry) {
  try {
    const ts = entry.ts || '';
    const res = await fetch(
      `${SB_URL}/training_sessions?training_day=eq.${day}&exercise_id=eq.${exerciseId}&session_kind=eq.check&order=created_at.desc&limit=1`,
      { headers: SB_HEADERS }
    );
    const rows = await res.json();
    if (rows.length > 0) {
      await fetch(`${SB_URL}/training_sessions?id=eq.${rows[0].id}`, {
        method: 'DELETE',
        headers: SB_HEADERS,
      });
    }
  } catch (e) {
    console.warn('Supabase delete check failed:', e);
  }
}

// Migrate old fitness_checkcount_ data to training_sessions
(function _migrateOldCheckCounts() {
  const migKey = `${_pfx}fitness_checkcount_migrated`;
  if (localStorage.getItem(migKey)) return;
  const data = _load();
  let changed = false;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k?.startsWith(`${_pfx}fitness_checkcount_`)) continue;
    const day = k.replace(`${_pfx}fitness_checkcount_`, '');
    try {
      const counts = JSON.parse(localStorage.getItem(k) || '{}');
      const checkKey = `${_pfx}fitness_check_${day}`;
      const checkData = JSON.parse(localStorage.getItem(checkKey) || '{}');
      for (const [exId, count] of Object.entries(counts)) {
        if (!data[day]) data[day] = {};
        const existing = (data[day][exId] || []).length;
        if (existing >= count) continue;
        if (!data[day][exId]) data[day][exId] = [];
        const baseTs = checkData[exId] ? new Date(checkData[exId]) : new Date(day + 'T12:00:00');
        for (let n = existing; n < count; n++) {
          const ts = new Date(baseTs.getTime() - (count - 1 - n) * 60000);
          data[day][exId].push({
            time: ts.toTimeString().slice(0, 5),
            totalReps: 1, sessionKind: 'check',
            ts: ts.toISOString(),
          });
        }
        changed = true;
      }
    } catch {}
  }
  if (changed) _save(data);
  localStorage.setItem(migKey, '1');
})();

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
  const key = `${_pfx}fitness_check_${day}`;
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
const WEIGHT_KEY = `${_pfx}fitness_weight_log`;

const USER_PROFILES = {
  default: { heightCm: 163, age: 28, sex: 'female' },
  b1:      { heightCm: 163, age: 28, sex: 'female' },
};
const PROFILE = USER_PROFILES[USER_ID] || USER_PROFILES.default;

function _loadWeights() {
  try { return JSON.parse(localStorage.getItem(WEIGHT_KEY)) || []; }
  catch { return []; }
}

export function recordWeight(kg) {
  const log = _loadWeights();
  const ts = new Date().toISOString();
  log.push({ kg, ts });
  localStorage.setItem(WEIGHT_KEY, JSON.stringify(log));
  _syncWeightToCloud(kg, ts);
}

async function _syncWeightToCloud(kg, ts) {
  try {
    await fetch(`${SB_URL}/weight_log`, {
      method: 'POST',
      headers: SB_HEADERS,
      body: JSON.stringify({ device_id: DEVICE_ID, kg, created_at: ts }),
    });
  } catch (e) {
    console.warn('Weight cloud sync failed:', e);
  }
}

async function _migrateWeightsToCloud() {
  const MIG_KEY = `${_pfx}fitness_migration_weight_v1`;
  if (localStorage.getItem(MIG_KEY)) return;
  const log = _loadWeights();
  if (!log.length) { localStorage.setItem(MIG_KEY, '1'); return; }
  try {
    const rows = log.map(w => ({ device_id: DEVICE_ID, kg: w.kg, created_at: w.ts }));
    await fetch(`${SB_URL}/weight_log`, {
      method: 'POST',
      headers: SB_HEADERS,
      body: JSON.stringify(rows),
    });
    localStorage.setItem(MIG_KEY, '1');
  } catch (e) {
    console.warn('Weight migration failed:', e);
  }
}
_migrateWeightsToCloud();

export function getWeightLog() {
  return _loadWeights();
}

export async function deleteWeight(idx) {
  const log = _loadWeights();
  if (idx < 0 || idx >= log.length) return;
  const removed = log.splice(idx, 1)[0];
  localStorage.setItem(WEIGHT_KEY, JSON.stringify(log));
  if (removed?.ts) await _deleteWeightFromCloud(removed.ts);
}

async function _deleteWeightFromCloud(ts) {
  try {
    const d = new Date(ts);
    const lo = new Date(d.getTime() - 1000).toISOString();
    const hi = new Date(d.getTime() + 1000).toISOString();
    await fetch(`${SB_URL}/weight_log?device_id=eq.${DEVICE_ID}&created_at=gte.${lo}&created_at=lte.${hi}`, {
      method: 'DELETE',
      headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` },
    });
  } catch (e) {
    console.warn('Weight cloud delete failed:', e);
  }
}

export function getLatestWeight() {
  const log = _loadWeights();
  return log.length ? log[log.length - 1].kg : null;
}

export function calcBMI(kg) {
  const hm = PROFILE.heightCm / 100;
  return kg / (hm * hm);
}

export function bmiToKg(bmi) {
  const hm = PROFILE.heightCm / 100;
  return bmi * hm * hm;
}

export function getHeightCm() {
  return PROFILE.heightCm;
}

export function getProfile() {
  return PROFILE;
}

// --- Period tracking ---
const PERIOD_KEY = `${_pfx}fitness_period_log`;

function _loadPeriods() {
  try { return JSON.parse(localStorage.getItem(PERIOD_KEY)) || []; }
  catch { return []; }
}

function _savePeriods(log) {
  localStorage.setItem(PERIOD_KEY, JSON.stringify(log));
}

export function getPeriodLog() { return _loadPeriods(); }

export function addPeriod(startDate) {
  const log = _loadPeriods();
  const endDate = _addDays(startDate, 6);
  log.push({ startDate, endDate });
  log.sort((a, b) => a.startDate.localeCompare(b.startDate));
  _savePeriods(log);
  _syncPeriodToCloud(startDate, endDate);
}

export async function endPeriodEarly(startDate, endDate) {
  const log = _loadPeriods();
  const rec = log.find(p => p.startDate === startDate);
  if (rec) {
    rec.endDate = endDate;
    _savePeriods(log);
    await _updatePeriodEndInCloud(startDate, endDate);
  }
}

export async function deletePeriod(startDate) {
  const log = _loadPeriods().filter(p => p.startDate !== startDate);
  _savePeriods(log);
  await _deletePeriodFromCloud(startDate);
}

async function _deletePeriodFromCloud(startDate) {
  try {
    await fetch(`${SB_URL}/period_log?device_id=eq.${DEVICE_ID}&start_date=eq.${startDate}`, {
      method: 'DELETE',
      headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` },
    });
  } catch (e) {
    console.warn('Period cloud delete failed:', e);
  }
}

export function isPeriodDay(dateStr) {
  for (const p of _loadPeriods()) {
    if (dateStr >= p.startDate && dateStr <= p.endDate) return true;
  }
  return false;
}

export function getCurrentPeriod() {
  const today = _trainingDay();
  for (const p of _loadPeriods()) {
    if (today >= p.startDate && today <= p.endDate) return p;
  }
  return null;
}

function _addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return _localDateStr(d);
}

async function _syncPeriodToCloud(startDate, endDate) {
  try {
    await fetch(`${SB_URL}/period_log`, {
      method: 'POST',
      headers: { ...SB_HEADERS, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ device_id: DEVICE_ID, start_date: startDate, end_date: endDate }),
    });
  } catch (e) {
    console.warn('Period cloud sync failed:', e);
  }
}

async function _updatePeriodEndInCloud(startDate, endDate) {
  try {
    await fetch(`${SB_URL}/period_log?device_id=eq.${DEVICE_ID}&start_date=eq.${startDate}`, {
      method: 'PATCH',
      headers: SB_HEADERS,
      body: JSON.stringify({ end_date: endDate }),
    });
  } catch (e) {
    console.warn('Period cloud update failed:', e);
  }
}

// --- Steps tracking ---
const STEPS_KEY = `${_pfx}fitness_steps_log`;

function _loadSteps() {
  try { return JSON.parse(localStorage.getItem(STEPS_KEY)) || []; }
  catch { return []; }
}

function _saveStepsLocal(log) {
  localStorage.setItem(STEPS_KEY, JSON.stringify(log));
}

export function recordSteps(date, steps) {
  const log = _loadSteps();
  const ts = new Date().toISOString();
  const idx = log.findIndex(e => e.date === date);
  if (idx >= 0) {
    log[idx] = { steps, date, ts };
  } else {
    log.push({ steps, date, ts });
    log.sort((a, b) => a.date.localeCompare(b.date));
  }
  _saveStepsLocal(log);
  _syncStepsToCloud(date, steps, ts);
}

async function _syncStepsToCloud(date, steps, ts) {
  try {
    await fetch(`${SB_URL}/steps_log`, {
      method: 'POST',
      headers: { ...SB_HEADERS, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ device_id: DEVICE_ID, date, steps, created_at: ts }),
    });
  } catch (e) {
    console.warn('Steps cloud sync failed:', e);
  }
}

export function getStepsLog() {
  return _loadSteps();
}

export function getStepsForDay(date) {
  const entry = _loadSteps().find(e => e.date === date);
  return entry ? entry.steps : 0;
}

export async function deleteSteps(date) {
  const log = _loadSteps().filter(e => e.date !== date);
  _saveStepsLocal(log);
  await _deleteStepsFromCloud(date);
}

async function _deleteStepsFromCloud(date) {
  try {
    await fetch(`${SB_URL}/steps_log?device_id=eq.${DEVICE_ID}&date=eq.${date}`, {
      method: 'DELETE',
      headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` },
    });
  } catch (e) {
    console.warn('Steps cloud delete failed:', e);
  }
}

(async function _seedHistoricalSteps() {
  if (USER_ID !== 'default') return;
  const MIG_KEY = `${_pfx}fitness_migration_steps_seed_v2`;
  if (localStorage.getItem(MIG_KEY)) return;
  const seedData = [
    ['2026-01-01',12828],['2026-01-02',561],['2026-01-03',903],['2026-01-04',275],
    ['2026-01-05',665],['2026-01-06',1097],['2026-01-07',666],['2026-01-08',329],
    ['2026-01-09',1317],['2026-01-10',12639],['2026-01-11',831],['2026-01-12',1290],
    ['2026-01-13',31],['2026-01-14',1072],['2026-01-15',258],['2026-01-16',946],
    ['2026-01-17',1233],['2026-01-18',999],['2026-01-19',1580],['2026-01-20',563],
    ['2026-01-21',1003],['2026-01-22',875],['2026-01-23',1118],['2026-01-24',508],
    ['2026-01-25',3426],['2026-01-26',968],['2026-01-27',1195],['2026-01-28',437],
    ['2026-01-29',532],['2026-01-30',539],['2026-01-31',2197],
    ['2026-02-01',1143],['2026-02-02',1247],['2026-02-03',322],['2026-02-04',4545],
    ['2026-02-05',1672],['2026-02-06',1210],['2026-02-07',4590],['2026-02-08',9197],
    ['2026-02-09',901],['2026-02-10',783],['2026-02-11',1104],['2026-02-12',2450],
    ['2026-02-13',953],['2026-02-14',3613],['2026-02-15',847],['2026-02-16',1723],
    ['2026-02-17',904],['2026-02-18',8271],['2026-02-19',724],['2026-02-20',613],
    ['2026-02-21',993],['2026-02-22',2132],['2026-02-23',1068],['2026-02-24',418],
    ['2026-02-25',948],['2026-02-26',1441],['2026-02-27',603],['2026-02-28',666],
    ['2026-03-01',859],['2026-03-02',3541],['2026-03-03',2695],['2026-03-04',2143],
    ['2026-03-05',1029],['2026-03-06',1819],['2026-03-07',1208],['2026-03-08',9645],
    ['2026-03-09',636],['2026-03-10',11700],['2026-03-11',722],['2026-03-12',933],
    ['2026-03-13',1891],['2026-03-14',2362],['2026-03-15',2182],['2026-03-16',1243],
    ['2026-03-17',1110],['2026-03-18',869],['2026-03-19',1369],['2026-03-20',8249],
    ['2026-03-21',885],['2026-03-22',1444],['2026-03-23',3664],['2026-03-24',579],
    ['2026-03-25',618],['2026-03-26',2768],['2026-03-27',654],['2026-03-28',668],
    ['2026-03-29',6387],['2026-03-30',112],
  ];
  const log = seedData.map(([date, steps]) => ({ steps, date, ts: `${date}T12:00:00.000Z` }));
  _saveStepsLocal(log);
  localStorage.setItem(MIG_KEY, String(Date.now()));
})();

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
        const key = `${_pfx}fitness_check_${c.training_day}`;
        const local = JSON.parse(localStorage.getItem(key) || '{}');
        if (!local[c.exercise_id]) {
          local[c.exercise_id] = c.checked_at;
          localStorage.setItem(key, JSON.stringify(local));
        }
      }
    }
    // Sync weight log — cloud is source of truth, local replaced entirely
    const res3 = await fetch(`${SB_URL}/weight_log?order=created_at.asc`, {
      headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` },
    });
    if (res3.ok) {
      const cloudWeights = await res3.json();
      const rebuilt = (cloudWeights || []).map(w => ({ kg: Number(w.kg), ts: w.created_at }));
      localStorage.setItem(WEIGHT_KEY, JSON.stringify(rebuilt));
    }
    // Sync period log — cloud is source of truth, local replaced entirely
    const res4 = await fetch(`${SB_URL}/period_log?order=start_date.asc`, {
      headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` },
    });
    if (res4.ok) {
      const cloudPeriods = await res4.json();
      const deduped = new Map();
      for (const p of (cloudPeriods || [])) {
        deduped.set(p.start_date, { startDate: p.start_date, endDate: p.end_date });
      }
      _savePeriods([...deduped.values()]);
    }
    // Sync steps log — cloud is source of truth, deduplicate by date
    const res5 = await fetch(`${SB_URL}/steps_log?order=date.asc`, {
      headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` },
    });
    if (res5.ok) {
      const cloudSteps = await res5.json();
      const deduped = new Map();
      for (const s of (cloudSteps || [])) {
        deduped.set(s.date, { steps: Number(s.steps), date: s.date, ts: s.created_at });
      }
      localStorage.setItem(STEPS_KEY, JSON.stringify([...deduped.values()]));
    }
  } catch (e) {
    console.warn('Cloud sync pull failed:', e);
  }
}
