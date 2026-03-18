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

// Public state
export function getState() { return _state; }
export function isRunning() { return _state !== 'idle' && _state !== 'done'; }

function _emit(info) {
  if (_onUpdate) _onUpdate({ state: _state, exercise: _exercise?.id, ...info });
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
    if (rem <= 5) {
      await voice.playNum(ex.ttsDir, rem, 0);
    }
    await _sleep(1000);
  }
  await _checkCancel();

  const startKey = ex.ttsMap?.['开始'] ? '开始' : null;
  if (startKey) await voice.say(ex.ttsDir, ex.ttsMap, startKey);

  if (ex.hasBGM) bgm.start();
  await _sleep(300);
}

// --- Counted reps mode (wall angel, shaker dyn) ---
async function _runCountedReps(ex) {
  _state = 'active';
  const { sets, reps, tempo, rest } = ex.defaults;
  let totalDone = 0;

  for (let s = 1; s <= sets; s++) {
    await _checkCancel();

    // Set announcement
    if (sets > 1 && ex.hasSetAnnounce) {
      await voice.playKey(ex.ttsDir, `set_${s}`, 0);
      await _sleep(80);
    }

    // Alternating side announcement
    if (ex.alternating) {
      const side = s % 2 === 1 ? '左腿' : '右腿';
      _emit({ phase: 'active', set: s, totalSets: sets, rep: 0, totalReps: reps, totalDone, text: side });
      await voice.say(null, null, side);
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

      for (let rem = rest; rem >= 1; rem--) {
        await _checkCancel();
        _emit({ phase: 'rest', remaining: rem, total: rest, text: `休息 ${rem}s` });
        if (rem <= 5) {
          await voice.playNum(ex.ttsDir, rem, 0);
        }
        await _sleep(1000);
      }

      _state = 'active';
      await voice.say(ex.ttsDir, ex.ttsMap, '继续');
      await _sleep(500);
    }
  }
  return totalDone;
}

// --- Timed hold mode (shaker iso, subman push) ---
async function _runTimedHold(ex) {
  _state = 'active';
  const { sets, holdSec, rest } = ex.defaults;
  let totalHold = 0;

  for (let s = 1; s <= sets; s++) {
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
      _emit({ phase: 'hold', set: s, totalSets: sets, remaining: holdSec, total: holdSec, text: side });
      await voice.say(null, null, side);
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
        await voice.playNum(ex.ttsDir, rem, 0);
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

      for (let rem = rest; rem >= 1; rem--) {
        await _checkCancel();
        _emit({ phase: 'rest', remaining: rem, total: rest, text: `休息 ${rem}s` });
        if (rem <= 3) await voice.playNum(ex.ttsDir, rem, 0);
        await _sleep(1000);
      }
      _state = 'active';
      voice.beep(1000, 200);
    }
  }
  return totalHold;
}

// --- Timed reps mode (FESM, chin tuck) ---
async function _runTimedReps(ex) {
  _state = 'active';
  const { sets, repsPerSet, holdSec, restRep, rest } = ex.defaults;
  let totalReps = 0;

  for (let s = 1; s <= sets; s++) {
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

      // Announce rep number
      if (r <= 30) voice.sayAsync(ex.ttsDir, null, String(r));

      // Hold
      for (let rem = holdSec; rem >= 1; rem--) {
        await _checkCancel();
        _emit({
          phase: 'hold', set: s, totalSets: sets, rep: r, totalReps: repsPerSet,
          remaining: rem, total: holdSec, text: `${rem}`,
        });
        if (rem <= 2) voice.beep(rem === 1 ? 1000 : 800, 100);
        await _sleep(1000);
      }
      voice.beep(600, 100);

      // Short rest between reps (within a set)
      if (r < repsPerSet && restRep > 0) {
        for (let rem = restRep; rem >= 1; rem--) {
          await _checkCancel();
          _emit({ phase: 'rest', remaining: rem, total: restRep, text: `${rem}` });
          await _sleep(1000);
        }
        voice.beep(800, 120);
      }

      if (r === Math.floor(repsPerSet / 2)) {
        voice.sayAsync(ex.ttsDir, ex.ttsMap, '过半了');
      }
    }

    // Rest between sets
    if (s < sets && rest > 0) {
      _state = 'rest';
      const nextSet = s + 1;
      await voice.playKey(ex.ttsDir, `rest_next_${nextSet}`, 0).catch(() => {
        voice.sayAsync(ex.ttsDir, ex.ttsMap, '休息');
      });

      for (let rem = rest; rem >= 1; rem--) {
        await _checkCancel();
        _emit({ phase: 'rest', remaining: rem, total: rest, text: `休息 ${rem}s` });
        if (rem <= 3) await voice.playNum(ex.ttsDir, rem, 0);
        await _sleep(1000);
      }
      _state = 'active';
      voice.beep(1000, 200);
    }
  }
  return totalReps;
}

// --- Public API ---

export async function startExercise(exercise, onUpdate) {
  if (isRunning()) return;
  _exercise = exercise;
  _onUpdate = onUpdate;
  _cancelFlag = false;
  _pauseFlag = false;
  _startTime = Date.now();
  _partialResult = 0;

  try {
    await _runPrep(exercise);
    let result;

    if (exercise.mode === 'counted_reps') {
      result = await _runCountedReps(exercise);
    } else if (exercise.mode === 'timed_hold') {
      result = await _runTimedHold(exercise);
    } else if (exercise.mode === 'timed_reps') {
      result = await _runTimedReps(exercise);
    }

    bgm.stop();
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
