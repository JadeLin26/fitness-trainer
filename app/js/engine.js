// Universal training engine — state machine that drives all exercise types.
// States: idle → prep → active → rest → done
// Modes: counted_reps, timed_hold, timed_reps

import * as voice from './voice.js';
import * as bgm from './bgm.js';
import * as store from './store.js';

let _state = 'idle';     // idle | prep | active | rest | done | paused
let _cancelFlag = false;
let _pauseFlag = false;
let _pauseResolve = null;
let _exercise = null;
let _onUpdate = null;    // callback: (stateInfo) => void
let _startTime = null;
let _partialResult = 0;
let _priorReps = 0;
let _priorHold = 0;
let _totalSets = 1;
let _startSet = 1;
let _wakeLock = null;

function _restTtsDir(ttsDir) {
  if (ttsDir === '../hyoid_tts') return '../trainer_tts';
  if (ttsDir === '../trainer_tts') return '../hyoid_tts';
  return ttsDir;
}

// Public state
export function getState() { return _state; }
export function isRunning() { return _state !== 'idle' && _state !== 'done'; }

function _estimateRemaining(ex, info) {
  const d = ex.defaults;
  const sets = d.sets || 1;
  const rest = d.rest || 0;
  const curSet = info.set || _startSet;
  const phase = info.phase;
  let sec = 0;

  if (phase === 'prep') {
    sec += info.remaining || 0;
    if (ex.mode === 'counted_reps') {
      sec += sets * (d.reps || 1) * (d.tempo || 2) + Math.max(0, sets - 1) * rest;
    } else if (ex.mode === 'timed_hold') {
      sec += sets * (d.holdSec || 1) + Math.max(0, sets - 1) * rest;
    } else if (ex.mode === 'timed_reps') {
      const repTime = (d.holdSec || 5) + (d.restRep || 0);
      sec += sets * (d.repsPerSet || 1) * repTime + Math.max(0, sets - 1) * rest;
    }
    return Math.max(0, Math.round(sec));
  }

  if (phase === 'rest') {
    sec += info.remaining || 0;
    const setsAfter = sets - curSet;
    const restsAfter = Math.max(0, setsAfter - 1);
    if (ex.mode === 'counted_reps') {
      sec += setsAfter * (d.reps || 1) * (d.tempo || 2) + restsAfter * rest;
    } else if (ex.mode === 'timed_hold') {
      sec += setsAfter * (d.holdSec || 1) + restsAfter * rest;
    } else if (ex.mode === 'timed_reps') {
      const repTime = (d.holdSec || 5) + (d.restRep || 0);
      sec += setsAfter * (d.repsPerSet || 1) * repTime + restsAfter * rest;
    }
    return Math.max(0, Math.round(sec));
  }

  if (ex.mode === 'counted_reps') {
    const reps = d.reps || 1;
    const tempo = d.tempo || 2;
    const repsLeft = reps - (info.rep || 0);
    sec += repsLeft * tempo;
    const setsAfter = sets - curSet;
    sec += setsAfter * (reps * tempo + rest);
  } else if (ex.mode === 'timed_hold') {
    sec += info.remaining || 0;
    const setsAfter = sets - curSet;
    sec += setsAfter * ((d.holdSec || 1) + rest);
  } else if (ex.mode === 'timed_reps') {
    const repsPerSet = d.repsPerSet || 1;
    const holdSec = d.holdSec || 5;
    const restRep = d.restRep || 0;
    const repTime = holdSec + restRep;
    sec += info.remaining || 0;
    const repsLeft = repsPerSet - (info.rep || 0);
    sec += repsLeft * repTime;
    const setsAfter = sets - curSet;
    sec += setsAfter * (repsPerSet * repTime + rest);
  }
  return Math.max(0, Math.round(sec));
}

function _emit(info) {
  const ex = _exercise;
  const d = ex?.defaults || {};
  let overallDone = 0, overallTotal = 0;
  if (ex?.mode === 'counted_reps') {
    overallTotal = (d.sets || 1) * (d.reps || 1);
    overallDone = _priorReps + (_partialResult || 0);
  } else if (ex?.mode === 'timed_hold') {
    overallTotal = (d.sets || 1) * (d.holdSec || 1);
    overallDone = _priorHold + (_partialResult || 0);
  } else if (ex?.mode === 'timed_reps') {
    overallTotal = (d.sets || 1) * (d.repsPerSet || 1);
    overallDone = _priorReps + (_partialResult || 0);
  }
  const overallProgress = overallTotal > 0 ? Math.min(overallDone / overallTotal, 1) : 0;
  const remainSec = _estimateRemaining(ex, info);
  if (_onUpdate) _onUpdate({
    state: _state, exercise: ex?.id,
    overallProgress, overallDone, overallTotal,
    overallSet: info.set || _startSet, overallTotalSets: _totalSets,
    remainingSeconds: remainSec,
    ...info,
  });
}

function _sleep(ms) {
  return new Promise(resolve => {
    const id = setTimeout(resolve, ms);
    const check = setInterval(() => {
      if (_cancelFlag) { clearTimeout(id); clearInterval(check); resolve(); }
    }, 50);
  });
}

async function _waitPause() {
  while (_pauseFlag && !_cancelFlag) {
    await new Promise(r => { _pauseResolve = r; });
  }
}

async function _checkCancel() {
  if (_cancelFlag) throw new Error('cancelled');
  await _waitPause();
  if (_cancelFlag) throw new Error('cancelled');
}

// --- Prep phase ---
async function _runPrep(ex) {
  _state = 'prep';
  const prepSec = ex.defaults.prepSec || 5;
  _emit({ phase: 'prep', total: prepSec, remaining: prepSec, text: '准备中' });

  if (ex.id === 'wall_angel') {
    voice.sayAsync(ex.ttsDir, ex.ttsMap, '走到墙边，准备靠墙天使');
    await _sleep(2500);
    await _checkCancel();
    voice.sayAsync(ex.ttsDir, ex.ttsMap, '要点：腰贴墙，后脑勺贴墙，收下巴，手臂全程贴墙');
  } else {
    voice.sayAsync(ex.ttsDir, ex.ttsMap, ex.ttsMap?.['准备'] ? '准备' : '准备好');
  }

  for (let rem = prepSec; rem >= 1; rem--) {
    await _checkCancel();
    _emit({ phase: 'prep', total: prepSec, remaining: rem, text: `准备 ${rem}` });
    if (rem <= 5) voice.playNum(ex.ttsDir, rem, 0);
    await _sleep(1000);
  }
  await _checkCancel();

  const startKey = ex.ttsMap?.['开始'] ? '开始' : null;
  if (startKey) await voice.say(ex.ttsDir, ex.ttsMap, startKey);

  if (ex.hasBGM) bgm.start();
  await _sleep(300);
}

// --- Counted reps mode (wall angel, pelvic tilt, alternating legs) ---
async function _runCountedReps(ex, startSet = 1) {
  _state = 'active';
  const { sets, reps, tempo, rest } = ex.defaults;
  let totalDone = 0;

  for (let s = startSet; s <= sets; s++) {
    await _checkCancel();

    // Set announcement
    if (sets > 1 && ex.hasSetAnnounce) {
      await voice.playKey(ex.ttsDir, `set_${s}`, 0);
      await _sleep(80);
    }

    // Alternating side announcement
    if (ex.alternating) {
      const side = s % 2 === 1 ? '左腿' : '右腿';
      const sideKey = s % 2 === 1 ? 'left_leg' : 'right_leg';
      _emit({ phase: 'active', set: s, totalSets: sets, rep: 0, totalReps: reps, totalDone, text: side });
      await voice.playKey('../hyoid_tts', sideKey, 0).catch(() => voice.say(null, null, side));
      await _sleep(500);
    }

    // Count reps
    for (let r = 1; r <= reps; r++) {
      await _checkCancel();
      totalDone++;
      _partialResult = totalDone;
      const tickStart = performance.now();
      _emit({
        phase: 'active', set: s, totalSets: sets, rep: r, totalReps: reps,
        totalDone, text: `${r}`,
      });

      if (r <= 30) {
        await voice.playNum(ex.ttsDir, r, tempo * 1000 * 0.5);
      }

      const elapsedMs = performance.now() - tickStart;
      const waitMs = Math.max(0, tempo * 1000 - elapsedMs);
      if (waitMs > 50) await _sleep(waitMs);
    }

    // Rest between sets
    if (s < sets && rest > 0) {
      _state = 'rest';
      if (ex.ttsDir === '../trainer_tts') {
        await voice.playKey(ex.ttsDir, `set_${s}_done`, 0);
      } else {
        const nextSet = s + 1;
        await voice.playKey(ex.ttsDir, `rest_next_${nextSet}`, 0).catch(() => {});
      }

      const restDir = _restTtsDir(ex.ttsDir);
      for (let rem = rest; rem >= 1; rem--) {
        await _checkCancel();
        _emit({ phase: 'rest', set: s, remaining: rem, total: rest, text: `休息 ${rem}s` });
        if (rem === 10 && rest >= 20) voice.playNum(restDir, 10, 0).catch(() => {});
        else if (rem <= 5) voice.playNum(restDir, rem, 0).catch(() => {});
        await _sleep(1000);
      }

      _state = 'active';
      await voice.say(ex.ttsDir, ex.ttsMap, '继续');
      await _sleep(500);
    }
  }
  return totalDone;
}

// --- Timed hold mode (subman push) ---
async function _runTimedHold(ex, startSet = 1) {
  _state = 'active';
  const { sets, holdSec, rest } = ex.defaults;
  let totalHold = 0;

  for (let s = startSet; s <= sets; s++) {
    await _checkCancel();

    if (sets > 1 && ex.hasSetAnnounce) {
      const holdKey = `set_${s}_hold`;
      const setKey = `set_${s}`;
      try { await voice.playKey(ex.ttsDir, holdKey, 0); }
      catch { await voice.playKey(ex.ttsDir, setKey, 0).catch(() => {}); }
    }

    // Alternating side announcement
    if (ex.alternating) {
      const side = s % 2 === 1 ? '左腿' : '右腿';
      const sideKey = s % 2 === 1 ? 'left_leg' : 'right_leg';
      _emit({ phase: 'hold', set: s, totalSets: sets, remaining: holdSec, total: holdSec, text: side });
      await voice.playKey('../hyoid_tts', sideKey, 0).catch(() => voice.say(null, null, side));
      await _sleep(500);
    }

    // Hold countdown
    for (let rem = holdSec; rem >= 1; rem--) {
      await _checkCancel();
      _emit({
        phase: 'hold', set: s, totalSets: sets, remaining: rem, total: holdSec,
        text: `保持 ${rem}s`,
      });
      if (holdSec >= 10 && rem <= 3) {
        voice.playNum(ex.ttsDir, rem, 0).catch(() => {});
      } else if (holdSec < 10 && rem <= 2) {
        voice.beep(rem === 1 ? 1000 : 800, 100);
      }
      await _sleep(1000);
    }
    totalHold += holdSec;
    _partialResult = totalHold;
    voice.beep(600, 100);

    // Rest between sets
    if (s < sets && rest > 0) {
      _state = 'rest';
      const nextSet = s + 1;
      await voice.playKey(ex.ttsDir, `rest_next_${nextSet}`, 0).catch(() => {
        voice.sayAsync(ex.ttsDir, ex.ttsMap, '休息');
      });

      const restDir = _restTtsDir(ex.ttsDir);
      for (let rem = rest; rem >= 1; rem--) {
        await _checkCancel();
        _emit({ phase: 'rest', set: s, remaining: rem, total: rest, text: `休息 ${rem}s` });
        if (rem <= 3) voice.playNum(restDir, rem, 0).catch(() => {});
        await _sleep(1000);
      }
      _state = 'active';
      voice.beep(1000, 200);
    }
  }
  return totalHold;
}

// --- Timed reps mode (FESM, chin tuck) ---
async function _runTimedReps(ex, startSet = 1) {
  _state = 'active';
  const { sets, repsPerSet, holdSec, restRep, rest } = ex.defaults;
  let totalReps = 0;

  for (let s = startSet; s <= sets; s++) {
    await _checkCancel();

    if (sets > 1 && ex.hasSetAnnounce) {
      await voice.playKey(ex.ttsDir, `set_${s}`, 0).catch(() => {});
    }

    for (let r = 1; r <= repsPerSet; r++) {
      await _checkCancel();
      totalReps++;
      _partialResult = totalReps;
      _emit({
        phase: 'hold', set: s, totalSets: sets, rep: r, totalReps: repsPerSet,
        remaining: holdSec, total: holdSec, text: `第${r}次 保持`,
      });

      // Announce rep number using pre-recorded WAV
      if (r <= 30) voice.playNum(ex.ttsDir, r, 0).catch(() => {});

      // Hold
      for (let rem = holdSec; rem >= 1; rem--) {
        await _checkCancel();
        _emit({
          phase: 'hold', set: s, totalSets: sets, rep: r, totalReps: repsPerSet,
          remaining: rem, total: holdSec, text: `${rem}`,
        });
        voice.beep(600 + (holdSec - rem) * 100, 100);
        await _sleep(1000);
      }
      voice.beep(600, 100);

      // Short rest between reps (within a set)
      if (r < repsPerSet && restRep > 0) {
        for (let rem = restRep; rem >= 1; rem--) {
          await _checkCancel();
          _emit({ phase: 'rest', set: s, remaining: rem, total: restRep, text: `${rem}` });
          await _sleep(1000);
        }
        voice.beep(800, 120);
      }

    }

    // Rest between sets
    if (s < sets && rest > 0) {
      _state = 'rest';
      const nextSet = s + 1;
      await voice.playKey(ex.ttsDir, `rest_next_${nextSet}`, 0).catch(() => {
        voice.sayAsync(ex.ttsDir, ex.ttsMap, '休息');
      });

      const restDir = _restTtsDir(ex.ttsDir);
      for (let rem = rest; rem >= 1; rem--) {
        await _checkCancel();
        _emit({ phase: 'rest', set: s, remaining: rem, total: rest, text: `休息 ${rem}s` });
        if (rem <= 3) voice.playNum(restDir, rem, 0).catch(() => {});
        await _sleep(1000);
      }
      _state = 'active';
      voice.beep(1000, 200);
    }
  }
  return totalReps;
}

// --- Public API ---

async function _acquireWakeLock() {
  try {
    if ('wakeLock' in navigator) _wakeLock = await navigator.wakeLock.request('screen');
  } catch {}
}
function _releaseWakeLock() {
  if (_wakeLock) { _wakeLock.release().catch(() => {}); _wakeLock = null; }
}

export async function startExercise(exercise, onUpdate, { startSet = 1, priorReps = 0, priorHold = 0 } = {}) {
  if (isRunning()) return;
  _exercise = exercise;
  _onUpdate = onUpdate;
  _cancelFlag = false;
  _pauseFlag = false;
  _startTime = Date.now();
  _acquireWakeLock();
  _partialResult = 0;
  _priorReps = priorReps;
  _priorHold = priorHold;
  _totalSets = exercise.defaults.sets || 1;
  _startSet = startSet;

  try {
    await _runPrep(exercise);
    let result;

    if (exercise.mode === 'counted_reps') {
      result = await _runCountedReps(exercise, startSet);
    } else if (exercise.mode === 'timed_hold') {
      result = await _runTimedHold(exercise, startSet);
    } else if (exercise.mode === 'timed_reps') {
      result = await _runTimedReps(exercise, startSet);
    }

    bgm.stop();
    _releaseWakeLock();
    _state = 'done';
    const duration = Math.round((Date.now() - _startTime) / 1000);

    // Record
    const d = exercise.defaults;
    store.recordSession(exercise.id, {
      sets: d.sets,
      repsPerSet: d.reps || d.repsPerSet || 0,
      totalReps: exercise.mode === 'timed_hold' ? 0 : result,
      holdSeconds: exercise.mode === 'timed_hold' ? result : (d.holdSec || 0),
      durationSeconds: duration,
      sessionKind: '完成',
    });
    store.markChecked(exercise.id, store.trainingDay());

    _emit({ phase: 'done', totalDone: result, duration, text: '训练完成' });
    await voice.say(exercise.ttsDir, exercise.ttsMap,
      exercise.ttsMap?.['训练完成，做得好'] ? '训练完成，做得好' : '训练完成');
    voice.beep(1200, 400);

  } catch (e) {
    bgm.stop();
    _releaseWakeLock();
    const duration = Math.round((Date.now() - _startTime) / 1000);
    if (e.message === 'cancelled' && _partialResult > 0) {
      const d = exercise.defaults;
      store.recordSession(exercise.id, {
        sets: d.sets,
        repsPerSet: d.reps || d.repsPerSet || 0,
        totalReps: exercise.mode === 'timed_hold' ? 0 : _partialResult,
        holdSeconds: exercise.mode === 'timed_hold' ? _partialResult : 0,
        durationSeconds: duration,
        sessionKind: '训练中止',
      });
    }
    _state = 'idle';
    _emit({
      phase: 'cancelled',
      duration,
      totalDone: _partialResult,
      text: e.message === 'cancelled' ? '训练中止' : '训练异常终止',
    });
    if (e.message !== 'cancelled') console.error('Training engine error:', e);
  }
}

export function pause() {
  if (_state === 'active' || _state === 'rest' || _state === 'prep') {
    _pauseFlag = true;
    _state = 'paused';
    bgm.stop();
    _emit({ phase: 'paused', text: '已暂停' });
  }
}

export function resume() {
  if (_state === 'paused') {
    _pauseFlag = false;
    _state = 'active';
    if (_exercise?.hasBGM) bgm.start();
    if (_pauseResolve) { _pauseResolve(); _pauseResolve = null; }
    _emit({ phase: 'resumed', text: '继续' });
  }
}

export function cancel() {
  _cancelFlag = true;
  if (_pauseFlag) {
    _pauseFlag = false;
    if (_pauseResolve) { _pauseResolve(); _pauseResolve = null; }
  }
  bgm.stop();
  _state = 'idle';
}

export function reset() {
  _state = 'idle';
  _pauseFlag = false;
  _exercise = null;
}
