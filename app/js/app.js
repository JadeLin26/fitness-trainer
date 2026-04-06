// Main app — renders exercise list, handles UI interactions, drives training overlay.

import { exercises, getExercise, getTrainableExercises, getDailyExercises } from './exercises.js';
import * as engine from './engine.js';
import * as store from './store.js';
import * as voice from './voice.js';

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

const CAT_ICON_FILES = {
  '头前倾矫正': 'icons/icon_neck.png',
  '舌骨肌群': 'icons/icon_hyoid.png',
  '辅助训练': 'icons/icon_auxiliary.png',
  '骨盆前倾矫正': 'icons/icon_pelvis.png',
  '圆肩驼背矫正': 'icons/icon_back.png',
};

const EX_ICON_FILES = {
  'subman_push': 'icons/icon_submental.png',
  'fesm': 'icons/icon_geniohyoid.png',
  'chin_tuck': 'icons/icon_deep_neck.png',
  'mewing': 'icons/icon_tongue.png',
  'pelvic_tilt': 'icons/icon_pelvic_tilt.png',
  'single_leg_lower': 'icons/icon_core.png',
  'single_glute_bridge': 'icons/icon_glute.png',
  'single_leg_deadlift': 'icons/icon_hamstring.png',
  'serratus_wall_push': 'icons/icon_serratus.png',
  'y_raise': 'icons/icon_lower_trap.png',
};

function _getExIcon(exId, category) {
  const src = EX_ICON_FILES[exId] || CAT_ICON_FILES[category] || CAT_ICON_FILES['辅助训练'];
  return `<img src="${src}" alt="${category}" draggable="false">`;
}

let _expandedId = null;
let _groupMode = 'category'; // 'category' or 'scene'

// --- Render exercise list ---
function renderList() {
  const list = $('.exercise-list');
  const day = store.trainingDay();

  const groups = {};
  const groupKey = _groupMode === 'scene' ? 'scene' : 'category';
  for (const ex of exercises) {
    const key = ex[groupKey] || '其他';
    if (!groups[key]) groups[key] = [];
    groups[key].push(ex);
  }

  // Scene mode: define a logical order
  const sceneOrder = ['仰卧', '俯卧 · 趴着', '跪姿 · 地面', '站立 · 靠墙', '站立', '坐姿 · 随时', '跟练视频'];
  const sortedKeys = _groupMode === 'scene'
    ? [...new Set([...sceneOrder.filter(k => groups[k]), ...Object.keys(groups)])]
    : Object.keys(groups);

  let html = '';
  for (const cat of sortedKeys) {
    const exs = groups[cat];
    if (!exs) continue;

    const totalMins = exs.reduce((s, ex) => s + (_estimateMinutes(ex) || 0), 0);
    const doneExs = exs.filter(ex => _isExDone(ex, day));
    const doneMins = doneExs.reduce((s, ex) => s + (_estimateMinutes(ex) || 0), 0);
    const remainMins = totalMins - doneMins;
    const countLabel = `${doneExs.length}/${exs.length}项`;
    const timeLabel = doneExs.length === exs.length
      ? `已全部完成 ✓`
      : doneExs.length > 0
        ? `还需约${remainMins}分钟`
        : `共约${totalMins}分钟`;

    html += `<div class="category-header">
      <span class="cat-title">${cat}</span>
      <span class="cat-progress">${countLabel} · ${timeLabel}</span>
    </div>`;
    for (const ex of exs) {
      const pct = _exProgress(ex, day);
      const expanded = _expandedId === ex.id;
      const params = _renderParams(ex);
      const hasVideo = ex.video && ex.video !== null;
      const hasImages = ex.images && ex.images.length > 0;

      const mediaHtml = hasVideo
        ? `<video class="ex-video" src="${ex.video}" controls preload="metadata" playsinline></video>`
        : hasImages
          ? `<div class="ex-images">${ex.images.map(src => `<img class="ex-image" src="${src}" loading="lazy" alt="${ex.name}">`).join('')}</div>`
          : '';

      html += `
        <div class="ex-card ${expanded ? 'expanded' : ''} ${ex.daily ? 'daily' : ''}" data-id="${ex.id}">
          <div class="ex-card-header" data-id="${ex.id}" role="button" tabindex="0" aria-expanded="${expanded}">
            <div class="ex-card-icon" data-cat="${ex.category}">${_getExIcon(ex.id, ex.category)}</div>
            <div class="ex-card-info">
              <div class="ex-card-name">${ex.name}</div>
              <div class="ex-card-sub">${_renderCardSummary(ex)}</div>
            </div>
            <div class="ex-card-status">
              <span class="ex-time-label">${_renderTimeLabel(ex, pct, day)}</span>
              ${_renderCheckRing(pct)}
              <span class="expand-arrow">›</span>
            </div>
          </div>
          ${ex.dailyCheckTarget ? `<div class="check-bar">
            ${store.getCheckCount(ex.id, day) > 0 ? `<button class="btn-check-dec" data-id="${ex.id}">-1</button>` : ''}
            <span class="check-count">${store.getCheckCount(ex.id, day)} / ${ex.dailyCheckTarget}</span>
            <button class="btn-check-inc" data-id="${ex.id}">+1 打卡</button>
          </div>` : ''}
          ${ex.mode ? `
          <div class="ex-card-detail">
            <div class="ex-detail-inner">
              <div class="ex-desc">${ex.description}</div>
              ${ex.tips ? `<div class="ex-tips">${ex.tips}</div>` : ''}
              ${ex.details ? `<div class="ex-details">${ex.details}</div>` : ''}
              ${ex.alternating ? `<div class="ex-alternating">🔄 奇数组左腿，偶数组右腿（语音会自动提示）</div>` : ''}
              ${params ? `<div class="ex-params">${params}</div>` : ''}
              ${mediaHtml}
              <button class="btn-start" data-id="${ex.id}">开始训练</button>
            </div>
          </div>` : `
          <div class="ex-card-detail">
            <div class="ex-detail-inner">
              <div class="ex-desc">${ex.description}</div>
              ${ex.tips ? `<div class="ex-tips">${ex.tips.replace(/\n/g, '<br>')}</div>` : ''}
              ${ex.details ? `<div class="ex-details">${ex.details.replace(/\n/g, '<br>')}</div>` : ''}
              ${mediaHtml}
              ${ex.externalVideo ? `<a class="btn-video-link" href="${ex.externalVideo}" target="_blank" rel="noopener">📺 打开跟练视频</a>` : ''}
              ${!ex.dailyCheckTarget ? `<button class="btn-check" data-id="${ex.id}">✓ 打勾完成</button>` : ''}
            </div>
          </div>`}
        </div>`;
    }
  }
  list.innerHTML = html;

  // Bind events
  list.querySelectorAll('.ex-card-header').forEach(h => {
    h.addEventListener('click', () => _toggleCard(h.dataset.id));
  });
  list.querySelectorAll('.btn-start[data-id]').forEach(btn => {
    const ex = getExercise(btn.dataset.id);
    if (ex && ex.mode) {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        _startTraining(ex);
      });
    }
  });
  list.querySelectorAll('.btn-check[data-id]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      store.markChecked(btn.dataset.id, store.trainingDay());
      renderList();
    });
  });
  list.querySelectorAll('.btn-check-inc[data-id]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      store.incrementCheck(btn.dataset.id, store.trainingDay());
      renderList();
    });
  });
  list.querySelectorAll('.btn-check-dec[data-id]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      store.decrementCheck(btn.dataset.id, store.trainingDay());
      renderList();
    });
  });

  _updateProgressSummary();
}

function _renderParams(ex) {
  if (!ex.mode) return '';
  const d = ex.defaults;
  const parts = [];
  if (d.sets && d.sets > 1) parts.push(`${d.sets}组`);
  if (d.reps) parts.push(`${d.reps}次`);
  if (d.repsPerSet) parts.push(`每组${d.repsPerSet}次`);
  if (d.holdSec) parts.push(`保持${d.holdSec}秒`);
  if (d.tempo) parts.push(`${d.tempo}秒/次`);
  if (d.rest && d.rest > 0) parts.push(`休息${d.rest}秒`);
  return parts.map(p => `<span class="ex-param">${p}</span>`).join('');
}

function _completionRatio(ex, dayReps, dayHold, checked, checkCount) {
  if (ex.dailyCheckTarget) return Math.min((checkCount || 0) / ex.dailyCheckTarget, 1);
  if (!ex.mode) return checked ? 1 : 0;
  const d = ex.defaults;
  let target, actual;
  if (ex.mode === 'counted_reps') {
    target = ex.dailyTarget || (d.sets || 1) * (d.reps || 1);
    actual = dayReps;
  } else if (ex.mode === 'timed_hold') {
    target = (d.sets || 1) * (d.holdSec || 1);
    actual = dayHold;
  } else if (ex.mode === 'timed_reps') {
    target = (d.sets || 1) * (d.repsPerSet || 1);
    actual = dayReps;
  } else {
    return checked ? 1 : 0;
  }
  if (target <= 0) return checked ? 1 : 0;
  return Math.min(actual / target, 1);
}

function _renderHeatDot(ratio) {
  if (ratio <= 0) return '';
  if (ratio >= 1) {
    return `<span class="hm-full">✓</span>`;
  }
  const pct = Math.round(ratio * 100);
  return `<div class="hm-bar"><div class="hm-bar-fill" style="width:${pct}%"></div></div>`;
}

function _estimateMinutes(ex) {
  if (ex.estimatedMinutes) return ex.estimatedMinutes;
  if (!ex.mode) return null;
  const d = ex.defaults;
  let sessionSec = (d.prepSec || 5);
  const sets = d.sets || 1;

  if (ex.mode === 'counted_reps') {
    const reps = d.reps || 0;
    const tempo = d.tempo || 2;
    sessionSec += sets * reps * tempo;
    sessionSec += Math.max(0, sets - 1) * (d.rest || 0);
  } else if (ex.mode === 'timed_hold') {
    sessionSec += sets * (d.holdSec || 0);
    sessionSec += Math.max(0, sets - 1) * (d.rest || 0);
  } else if (ex.mode === 'timed_reps') {
    const repsPerSet = d.repsPerSet || 0;
    const holdSec = d.holdSec || 0;
    const restRep = d.restRep || 0;
    sessionSec += sets * (repsPerSet * (holdSec + restRep));
    sessionSec += Math.max(0, sets - 1) * (d.rest || 0);
  }

  if (ex.dailyTarget && ex.mode === 'counted_reps') {
    const repsPerSession = sets * (d.reps || 1);
    const sessions = Math.ceil(ex.dailyTarget / repsPerSession);
    return Math.ceil(sessions * sessionSec / 60);
  }

  return Math.ceil(sessionSec / 60);
}

function _renderCardSummary(ex) {
  if (ex.dailyCheckTarget) {
    const cnt = store.getCheckCount(ex.id, store.trainingDay());
    return `今日 ${cnt}/${ex.dailyCheckTarget} · ${ex.subtitle || ''}`;
  }
  if (!ex.mode) return ex.subtitle;
  const d = ex.defaults;
  const parts = [];
  const sets = d.sets || 1;

  if (ex.mode === 'counted_reps') {
    parts.push(sets > 1 ? `${sets}组×${d.reps}次` : `${d.reps}次`);
  } else if (ex.mode === 'timed_hold') {
    parts.push(sets > 1 ? `${sets}组×${d.holdSec}秒` : `保持${d.holdSec}秒`);
  } else if (ex.mode === 'timed_reps') {
    parts.push(sets > 1 ? `${sets}组×${d.repsPerSet}次×${d.holdSec}秒` : `${d.repsPerSet}次×${d.holdSec}秒`);
  }

  const mins = _estimateMinutes(ex);
  if (mins) parts.push(`约${mins}分钟`);

  return parts.join(' · ');
}

function _toggleCard(id) {
  _expandedId = _expandedId === id ? null : id;
  renderList();
}

// --- Progress summary ---
function _isExDone(ex, day) {
  if (ex.dailyTarget) {
    const reps = store.getDayTotalReps(ex.id, day);
    return reps >= ex.dailyTarget;
  }
  if (ex.dailyCheckTarget) {
    return store.getCheckCount(ex.id, day) >= ex.dailyCheckTarget;
  }
  return store.isChecked(ex.id, day);
}

function _exProgress(ex, day) {
  if (ex.dailyCheckTarget) {
    return Math.min(store.getCheckCount(ex.id, day) / ex.dailyCheckTarget, 1);
  }
  if (!ex.mode) return store.isChecked(ex.id, day) ? 1 : 0;
  if (ex.dailyTarget) {
    return Math.min(store.getDayTotalReps(ex.id, day) / ex.dailyTarget, 1);
  }
  const d = ex.defaults;
  const reps = store.getDayTotalReps(ex.id, day);
  const hold = store.getDayTotalHoldSec(ex.id, day);
  if (ex.mode === 'counted_reps') return Math.min(reps / ((d.sets || 1) * (d.reps || 1)), 1);
  if (ex.mode === 'timed_hold') return Math.min(hold / ((d.sets || 1) * (d.holdSec || 1)), 1);
  if (ex.mode === 'timed_reps') return Math.min(reps / ((d.sets || 1) * (d.repsPerSet || 1)), 1);
  return store.isChecked(ex.id, day) ? 1 : 0;
}

function _getLastSessionTime(ex, day) {
  const sessions = store.getDaySessions(ex.id, day);
  if (sessions.length > 0) {
    const withTs = sessions.filter(s => s.ts);
    if (withTs.length > 0) {
      withTs.sort((a, b) => a.ts.localeCompare(b.ts));
      return new Date(withTs[withTs.length - 1].ts);
    }
  }
  if (ex.dailyCheckTarget) return null;
  if (store.isChecked(ex.id, day)) {
    try {
      const checks = store.getDayChecks(day);
      if (checks[ex.id]) return new Date(checks[ex.id]);
    } catch {}
  }
  return null;
}

function _formatElapsed(ms) {
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 1) return '刚刚';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}分钟前`;
  return m > 0 ? `${h}小时${m}分前` : `${h}小时前`;
}

function _renderTimeLabel(ex, pct, day) {
  const lastTime = _getLastSessionTime(ex, day);
  if (!lastTime) return '';
  if (pct >= 1) {
    const hh = String(lastTime.getHours()).padStart(2, '0');
    const mm = String(lastTime.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  const elapsed = Date.now() - lastTime.getTime();
  if (elapsed < 0) return '';
  return _formatElapsed(elapsed);
}

function _renderCheckRing(pct) {
  if (pct >= 1) {
    return `<span class="ring-pct green">100%</span><div class="check-ring full">✓</div>`;
  }
  if (pct <= 0) {
    return `<span class="ring-pct muted">0%</span><div class="check-ring"></div>`;
  }
  const deg = Math.round(pct * 360);
  return `<span class="ring-pct yellow">${Math.round(pct * 100)}%</span><div class="check-ring partial" style="background:conic-gradient(var(--green) ${deg}deg, var(--border) ${deg}deg)"></div>`;
}

const EX_MET = {
  'wall_angel': 3.0,
  'subman_push': 2.0, 'fesm': 2.0,
  'chin_tuck': 2.0, 'mewing': 1.0,
  'pelvic_tilt': 3.0,
  'single_leg_lower': 3.5, 'single_glute_bridge': 4.0,
  'single_leg_deadlift': 4.0,
  'band_back': 3.5,
  'serratus_wall_push': 2.5,
  'y_raise': 2.5,
};
function _getBodyWeight() {
  return store.getLatestWeight() || 55;
}

function _calcStepsCaloriesRaw(steps) {
  if (!steps || steps <= 0) return 0;
  const weight = _getBodyWeight();
  return 3.3 * weight * 3.5 / 200 * (steps / 100);
}

function _calcDayCalories(day) {
  const weight = _getBodyWeight();
  let total = 0;
  for (const ex of exercises) {
    const met = EX_MET[ex.id] || 2.5;

    const sessions = store.getDaySessions(ex.id, day);
    for (const s of sessions) {
      const mins = (s.durationSeconds || 0) / 60;
      total += met * weight * 3.5 / 200 * mins;
    }

    if (!ex.mode && ex.estimatedMinutes && sessions.length === 0 && store.isChecked(ex.id, day)) {
      total += met * weight * 3.5 / 200 * ex.estimatedMinutes;
    }
  }
  total += _calcStepsCaloriesRaw(store.getStepsForDay(day));
  return Math.round(total);
}

function _calcTodayCalories() {
  return _calcDayCalories(store.trainingDay());
}

function _calEquiv(cal) {
  if (cal <= 0) return '';
  if (cal < 8) return `≈ 走了 ${Math.round(cal * 25)} 步`;
  if (cal < 20) return `≈ 步行 ${Math.round(cal / 4 * 100)}m`;
  if (cal < 50) return `≈ ${(cal / 50).toFixed(1)} 个水煮蛋`;
  if (cal < 100) return `≈ ${(cal / 86).toFixed(1)} 杯拿铁`;
  if (cal < 200) return `≈ ${(cal / 232).toFixed(1)} 碗米饭`;
  return `≈ ${(cal / 232).toFixed(1)} 碗米饭 💪`;
}

function _updateProgressSummary() {
  const day = store.trainingDay();
  const dailyExs = getDailyExercises();
  let done = 0;
  for (const ex of dailyExs) {
    if (_isExDone(ex, day)) done++;
  }
  const total = dailyExs.length;
  const pct = total ? Math.round(done / total * 100) : 0;

  $('.progress-value').textContent = `${done}/${total}`;
  $('.progress-label').textContent = `每日必做 ${pct}%`;

  const circ = 2 * Math.PI * 18;
  const offset = circ * (1 - pct / 100);
  const fg = $('.summary-ring-fg');
  if (fg) {
    fg.style.strokeDasharray = `${circ}`;
    fg.style.strokeDashoffset = `${offset}`;
  }

  const cal = _calcTodayCalories();
  const calEl = $('.cal-number');
  const equivEl = $('.cal-equiv');
  if (calEl) calEl.textContent = `🔥 ${cal} kcal`;
  if (equivEl) equivEl.textContent = _calEquiv(cal);
}

// --- Training overlay ---
function _startTraining(ex) {
  const overlay = $('.training-overlay');
  overlay.classList.add('active');
  $('.training-title').textContent = ex.name;
  $('.training-subtitle').textContent = ex.tips || ex.subtitle;

  let refHtml = '';
  if (ex.images?.length) {
    refHtml += ex.images.map(src => `<img class="training-ref-img" src="${src}" alt="${ex.name}">`).join('');
  }
  if (ex.video) {
    refHtml += `<video class="training-ref-vid" src="${ex.video}" muted playsinline loop autoplay></video>`;
  }
  if (ex.details) {
    refHtml += `<div class="training-ref-details">${ex.details.replace(/\n/g, '<br>')}</div>`;
  }
  $('.training-tips').innerHTML = refHtml;

  const btnPause = $('.btn-pause');
  const btnStop = $('.btn-stop');
  const btnResume = $('.btn-resume');
  btnPause.style.display = '';
  btnResume.style.display = 'none';

  const day = store.trainingDay();
  const d = ex.defaults;
  const priorReps = store.getDayTotalReps(ex.id, day);
  const priorHold = store.getDayTotalHoldSec(ex.id, day);
  let startSet = 1;
  if (ex.mode === 'counted_reps' && d.reps) {
    startSet = Math.floor(priorReps / d.reps) + 1;
  } else if (ex.mode === 'timed_hold' && d.holdSec) {
    startSet = Math.floor(priorHold / d.holdSec) + 1;
  } else if (ex.mode === 'timed_reps' && d.repsPerSet) {
    startSet = Math.floor(priorReps / d.repsPerSet) + 1;
  }
  if (startSet > (d.sets || 1)) startSet = 1;

  engine.startExercise(ex, info => {
    _updateTrainingUI(info, ex);
  }, { startSet, priorReps, priorHold });
}

function _fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m > 0) return `${m}分${s > 0 ? s + '秒' : ''}`;
  return `${s}秒`;
}

function _updateTrainingUI(info, ex) {
  const numEl = $('.ring-number');
  const labelEl = $('.ring-label');
  const progressEl = $('.training-progress-text');
  const fg = $('.ring-timer-fg');
  const circ = 2 * Math.PI * 100;

  if (!numEl) return;

  const fill = $('.training-progress-fill');
  const pLabel = $('.training-progress-label');
  const remEl = $('.training-remaining');
  if (fill && info.overallProgress !== undefined) {
    fill.style.width = `${Math.round(info.overallProgress * 100)}%`;
  }
  if (pLabel && info.overallSet !== undefined) {
    pLabel.textContent = `第${info.overallSet}组/共${info.overallTotalSets}组 · ${info.overallDone}/${info.overallTotal}`;
  }
  if (remEl && info.remainingSeconds !== undefined && info.phase !== 'done' && info.phase !== 'cancelled') {
    remEl.textContent = `剩余 ${_fmtTime(info.remainingSeconds)}`;
  }

  if (info.phase === 'prep') {
    numEl.textContent = info.remaining;
    labelEl.textContent = '准备中';
    const offset = circ * (1 - info.remaining / info.total);
    fg.style.strokeDasharray = `${circ}`;
    fg.style.strokeDashoffset = `${offset}`;
    fg.style.stroke = 'var(--orange)';
    progressEl.textContent = info.text;
  }
  else if (info.phase === 'active') {
    numEl.textContent = info.text || info.rep;
    const sideTag = ex.alternating && info.set ? (info.set % 2 === 1 ? ' · 左腿' : ' · 右腿') : '';
    labelEl.textContent = info.totalSets > 1
      ? `第${info.set}组${sideTag} / ${info.totalReps}次`
      : `${info.rep || 0}/${info.totalReps || 0}`;
    const pct = (info.rep || 0) / (info.totalReps || 1);
    fg.style.strokeDasharray = `${circ}`;
    fg.style.strokeDashoffset = `${circ * (1 - pct)}`;
    fg.style.stroke = 'var(--accent)';
    if (info.totalDone !== undefined) {
      progressEl.textContent = `已完成 ${info.totalDone} 次`;
    }
  }
  else if (info.phase === 'hold') {
    numEl.textContent = info.remaining;
    const sideTag = ex.alternating && info.set ? (info.set % 2 === 1 ? ' · 左腿' : ' · 右腿') : '';
    let holdLabel = '';
    if (info.totalSets > 1) {
      holdLabel = `第${info.set}组${sideTag}`;
      if (info.rep != null) holdLabel += ` 第${info.rep}次`;
    } else {
      holdLabel = info.rep != null ? `第${info.rep}次` : '保持中';
    }
    labelEl.textContent = holdLabel;
    const pct = info.remaining / info.total;
    fg.style.strokeDasharray = `${circ}`;
    fg.style.strokeDashoffset = `${circ * (1 - pct)}`;
    fg.style.stroke = 'var(--teal)';
    progressEl.textContent = `保持 ${info.remaining}s`;
  }
  else if (info.phase === 'rest') {
    numEl.textContent = info.remaining;
    labelEl.textContent = '休息';
    const pct = info.remaining / info.total;
    fg.style.strokeDasharray = `${circ}`;
    fg.style.strokeDashoffset = `${circ * (1 - pct)}`;
    fg.style.stroke = 'var(--green)';
    progressEl.textContent = info.text;
  }
  else if (info.phase === 'paused') {
    numEl.textContent = '⏸';
    labelEl.textContent = '已暂停';
    fg.style.stroke = 'var(--purple)';
    progressEl.textContent = '点击继续';
    $('.btn-pause').style.display = 'none';
    $('.btn-resume').style.display = '';
  }
  else if (info.phase === 'resumed') {
    $('.btn-pause').style.display = '';
    $('.btn-resume').style.display = 'none';
  }
  else if (info.phase === 'done') {
    numEl.textContent = '✓';
    numEl.style.color = 'var(--green)';
    labelEl.textContent = '训练完成';
    fg.style.strokeDasharray = `${circ}`;
    fg.style.strokeDashoffset = '0';
    fg.style.stroke = 'var(--green)';
    const dm = Math.floor(info.duration / 60);
    const ds = info.duration % 60;
    progressEl.textContent = `用时 ${dm > 0 ? dm + '分' : ''}${ds}秒`;
    if (fill) fill.style.width = '100%';
    if (pLabel) pLabel.textContent = '全部完成！';
    if (remEl) remEl.textContent = '';
    setTimeout(() => _closeOverlay(), 5000);
  }
  else if (info.phase === 'cancelled') {
    _closeOverlay();
  }
}

function _closeOverlay() {
  $('.training-overlay').classList.remove('active');
  $('.ring-number').style.color = '';
  $('.training-tips').innerHTML = '';
  $('.training-progress-fill').style.width = '0%';
  $('.training-progress-label').textContent = '';
  $('.training-remaining').textContent = '';
  engine.reset();
  renderList();
}

// --- Stats panel ---
let _weekOffset = 0;

function _localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _getWeekDays(offset = 0) {
  const now = new Date();
  const dow = now.getDay(); // 0=Sun
  const sun = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow + offset * 7);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(sun);
    d.setDate(sun.getDate() + i);
    days.push(_localDateStr(d));
  }
  return days;
}

function _getWeekLabel(offset) {
  if (offset === 0) return '本周';
  if (offset === -1) return '上周';
  const days = _getWeekDays(offset);
  return `${days[0].slice(5)} ~ ${days[6].slice(5)}`;
}

function _openStats() {
  $('.stats-panel').style.display = '';
  document.body.style.overflow = 'hidden';
  _renderStats();
}

function _closeStats() {
  $('.stats-panel').style.display = 'none';
  document.body.style.overflow = '';
  _weekOffset = 0;
}

// --- Weight panel ---
function _openWeight() {
  $('.weight-panel').style.display = '';
  document.body.style.overflow = 'hidden';
  const latest = store.getLatestWeight();
  if (latest) $('.weight-input').value = Number(latest).toFixed(1);
  _renderWeightPage();
}

function _closeWeight() {
  $('.weight-panel').style.display = 'none';
  document.body.style.overflow = '';
}

function _saveWeight() {
  const input = $('.weight-input');
  const kg = parseFloat(input.value);
  if (!kg || kg < 30 || kg > 200) return;
  store.recordWeight(kg);
  _renderWeightPage();
  _updateProgressSummary();
}

function _bmiCategory(bmi) {
  if (bmi < 18.5) return { label: '偏瘦', color: '#42A5F5' };
  if (bmi < 24) return { label: '正常', color: '#4CAF50' };
  if (bmi < 28) return { label: '偏胖', color: '#FFA726' };
  return { label: '肥胖', color: '#E53935' };
}

function _renderWeightPage() {
  const log = store.getWeightLog();
  const bmiEl = $('.weight-bmi-display');

  if (log.length === 0) {
    bmiEl.innerHTML = '<div style="color:var(--text2)">还没有体重记录，输入体重开始追踪</div>';
  } else {
    const latest = log[log.length - 1];
    const bmi = store.calcBMI(latest.kg);
    const cat = _bmiCategory(bmi);
    const first = log[0];
    const diff = latest.kg - first.kg;
    const diffStr = diff > 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1);
    const diffColor = diff > 0 ? '#E53935' : diff < 0 ? '#4CAF50' : 'var(--text2)';

    bmiEl.innerHTML = `
      <div style="margin-bottom:8px">
        <span class="bmi-value">${bmi.toFixed(1)}</span>
        <span class="bmi-tag" style="background:${cat.color}">${cat.label}</span>
        <span style="font-size:13px;color:var(--text2);margin-left:8px">BMI</span>
      </div>
      <div style="font-size:13px;color:var(--text2)">
        当前 <strong style="color:var(--text1)">${Number(latest.kg).toFixed(1)} kg</strong>
        ${log.length > 1 ? `· 累计 <strong style="color:${diffColor}">${diffStr} kg</strong>` : ''}
        · 共 ${log.length} 条记录
      </div>`;
  }

  _renderWeightChart(log);
  _renderWeightHistory(log);
}

function _renderWeightChart(log) {
  const canvas = $('.weight-chart');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  const W = rect.width, H = rect.height;
  ctx.clearRect(0, 0, W, H);

  if (log.length < 2) {
    ctx.fillStyle = '#999';
    ctx.font = '13px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('记录 2 条以上体重后显示曲线', W / 2, H / 2);
    return;
  }

  const BMI_NORMAL_LO = 18.5, BMI_NORMAL_HI = 24;
  const BMI_OVERWEIGHT = 28;
  const kgNormalLo = store.bmiToKg(BMI_NORMAL_LO);
  const kgNormalHi = store.bmiToKg(BMI_NORMAL_HI);

  const pad = { top: 20, right: 44, bottom: 30, left: 42 };
  const cw = W - pad.left - pad.right;
  const ch = H - pad.top - pad.bottom;

  const weights = log.map(e => e.kg);
  let minW = Math.min(...weights);
  let maxW = Math.max(...weights);
  const dataSpan = maxW - minW;
  const halfRange = Math.max(dataSpan * 0.7, 0.5);
  const mid = (minW + maxW) / 2;
  minW = mid - halfRange;
  maxW = mid + halfRange;
  const range = maxW - minW || 1;

  const timestamps = log.map(e => new Date(e.ts).getTime());
  const tMin = timestamps[0], tMax = timestamps[timestamps.length - 1];
  const tRange = tMax - tMin || 1;

  const toX = (i) => pad.left + ((timestamps[i] - tMin) / tRange) * cw;
  const toY = (kg) => pad.top + (1 - (kg - minW) / range) * ch;
  const kgToBmi = (kg) => store.calcBMI(kg);

  // BMI normal range green band
  const bandTop = Math.max(toY(kgNormalHi), pad.top);
  const bandBot = Math.min(toY(kgNormalLo), pad.top + ch);
  if (bandBot > bandTop) {
    ctx.fillStyle = 'rgba(76,175,80,0.10)';
    ctx.fillRect(pad.left, bandTop, cw, bandBot - bandTop);
    ctx.strokeStyle = 'rgba(76,175,80,0.30)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    [bandTop, bandBot].forEach(y => {
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(W - pad.right, y);
      ctx.stroke();
    });
    ctx.setLineDash([]);
  }

  // Grid lines + left axis (kg)
  ctx.strokeStyle = '#eee';
  ctx.lineWidth = 1;
  const steps = 5;
  for (let i = 0; i <= steps; i++) {
    const y = pad.top + (i / steps) * ch;
    const val = maxW - (i / steps) * range;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(W - pad.right, y);
    ctx.stroke();
    ctx.fillStyle = '#666';
    ctx.font = '11px system-ui';
    ctx.textAlign = 'right';
    ctx.fillText(val.toFixed(1), pad.left - 6, y + 4);
  }

  // Right axis (BMI)
  ctx.textAlign = 'left';
  for (let i = 0; i <= steps; i++) {
    const val = maxW - (i / steps) * range;
    const bmi = kgToBmi(val);
    const y = pad.top + (i / steps) * ch;
    const color = (bmi >= BMI_NORMAL_LO && bmi <= BMI_NORMAL_HI) ? '#4CAF50' :
                  (bmi > BMI_OVERWEIGHT) ? '#F44336' : '#FF9800';
    ctx.fillStyle = color;
    ctx.font = '10px system-ui';
    ctx.fillText(bmi.toFixed(1), W - pad.right + 6, y + 4);
  }

  // Axis labels
  ctx.fillStyle = '#999';
  ctx.font = '10px system-ui';
  ctx.textAlign = 'right';
  ctx.fillText('kg', pad.left - 6, pad.top - 6);
  ctx.textAlign = 'left';
  ctx.fillText('BMI', W - pad.right + 4, pad.top - 6);

  // Date labels
  ctx.fillStyle = '#999';
  ctx.font = '10px system-ui';
  ctx.textAlign = 'center';
  const labelCount = Math.min(6, Math.ceil((tMax - tMin) / 86400000) + 1);
  for (let i = 0; i < labelCount; i++) {
    const t = tMin + (i / (labelCount - 1)) * tRange;
    const x = pad.left + (i / (labelCount - 1)) * cw;
    const d = new Date(t);
    ctx.fillText(`${d.getMonth() + 1}/${d.getDate()}`, x, H - 8);
  }

  // Line segments colored by BMI zone
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (let i = 1; i < log.length; i++) {
    const bmi = kgToBmi((log[i - 1].kg + log[i].kg) / 2);
    ctx.strokeStyle = (bmi >= BMI_NORMAL_LO && bmi <= BMI_NORMAL_HI) ? '#4CAF50' :
                      (bmi > BMI_OVERWEIGHT) ? '#F44336' : '#FF9800';
    ctx.beginPath();
    ctx.moveTo(toX(i - 1), toY(log[i - 1].kg));
    ctx.lineTo(toX(i), toY(log[i].kg));
    ctx.stroke();
  }

  // Area fill under line with gradient
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = '#4CAF50';
  ctx.beginPath();
  ctx.moveTo(toX(0), toY(log[0].kg));
  for (let i = 1; i < log.length; i++) ctx.lineTo(toX(i), toY(log[i].kg));
  ctx.lineTo(toX(log.length - 1), pad.top + ch);
  ctx.lineTo(toX(0), pad.top + ch);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  // Dots colored by BMI
  log.forEach((e, i) => {
    const bmi = kgToBmi(e.kg);
    ctx.fillStyle = (bmi >= BMI_NORMAL_LO && bmi <= BMI_NORMAL_HI) ? '#4CAF50' :
                    (bmi > BMI_OVERWEIGHT) ? '#F44336' : '#FF9800';
    ctx.beginPath();
    ctx.arc(toX(i), toY(e.kg), 3.5, 0, Math.PI * 2);
    ctx.fill();
  });

  // BMI range label inside band
  if (bandBot > bandTop + 16) {
    ctx.fillStyle = 'rgba(76,175,80,0.5)';
    ctx.font = '10px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(`正常 ${kgNormalLo.toFixed(1)}–${kgNormalHi.toFixed(1)} kg`, pad.left + cw / 2, (bandTop + bandBot) / 2 + 3);
  }
}

function _renderWeightHistory(log) {
  const container = $('.weight-history');
  if (log.length === 0) { container.innerHTML = ''; return; }
  const recent = [...log].reverse().slice(0, 30);
  let html = '<div style="font-size:13px;font-weight:600;color:var(--text2);margin-bottom:8px">最近记录</div>';
  for (let i = 0; i < recent.length; i++) {
    const e = recent[i];
    const d = new Date(e.ts);
    const dateStr = `${d.getMonth() + 1}/${d.getDate()} ${d.toTimeString().slice(0, 5)}`;
    const idx = log.length - 1 - i;
    const bmi = store.calcBMI(e.kg);
    const bmiColor = (bmi >= 18.5 && bmi <= 24) ? '#4CAF50' : bmi > 28 ? '#F44336' : '#FF9800';
    html += `<div class="wh-item">
      <span class="wh-kg">${Number(e.kg).toFixed(1)} kg</span>
      <span class="wh-bmi" style="color:${bmiColor}">BMI ${bmi.toFixed(1)}</span>
      <span class="wh-time">${dateStr}</span>
      <button class="wh-del" data-idx="${idx}" title="删除">✕</button>
    </div>`;
  }
  container.innerHTML = html;
  container.querySelectorAll('.wh-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      store.deleteWeight(idx);
      _renderWeightPage();
      _updateProgressSummary();
    });
  });
}

// --- Period panel ---
let _periodMonthOffset = 0;
let _selectedDate = null;

function _openPeriod() {
  _periodMonthOffset = 0;
  _selectedDate = store.trainingDay();
  $('.period-panel').style.display = '';
  document.body.style.overflow = 'hidden';
  _renderPeriodPage();
}

function _closePeriod() {
  $('.period-panel').style.display = 'none';
  document.body.style.overflow = '';
  _selectedDate = null;
}

function _getPeriodMonthDays(offset) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + offset;
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);

  const startDay = first.getDay(); // 0=Sun
  const totalDays = last.getDate();

  const cells = [];
  // Fill leading days from previous month
  const prevLast = new Date(year, month, 0);
  for (let i = startDay - 1; i >= 0; i--) {
    const d = new Date(prevLast);
    d.setDate(prevLast.getDate() - i);
    cells.push({ date: _localDateStr(d), day: d.getDate(), thisMonth: false });
  }
  // Current month days
  for (let d = 1; d <= totalDays; d++) {
    const dt = new Date(year, month, d);
    cells.push({ date: _localDateStr(dt), day: d, thisMonth: true });
  }
  // Fill trailing days
  while (cells.length % 7 !== 0) {
    const dt = new Date(year, month + 1, cells.length - startDay - totalDays + 1);
    cells.push({ date: _localDateStr(dt), day: dt.getDate(), thisMonth: false });
  }

  return {
    label: `${first.getFullYear()}年${first.getMonth() + 1}月`,
    cells,
  };
}

function _renderPeriodPage() {
  const { label, cells } = _getPeriodMonthDays(_periodMonthOffset);
  const today = store.trainingDay();
  const periods = store.getPeriodLog();
  const currentPeriod = store.getCurrentPeriod();

  $('.period-month-label').textContent = label;

  // Calendar
  const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
  let html = '<table class="pcal-table"><thead><tr>';
  for (const n of dayNames) html += `<th>${n}</th>`;
  html += '</tr></thead><tbody>';

  for (let r = 0; r < cells.length; r += 7) {
    html += '<tr>';
    for (let c = 0; c < 7; c++) {
      const cell = cells[r + c];
      const isPeriod = store.isPeriodDay(cell.date);
      const isStart = periods.some(p => p.startDate === cell.date);
      const isToday = cell.date === today;
      const isSelected = cell.date === _selectedDate;
      const cls = [
        'pcal-day',
        !cell.thisMonth ? 'other-month' : '',
        isStart ? 'period-start' : isPeriod ? 'period' : '',
        isToday ? 'today' : '',
        isSelected ? 'selected' : '',
      ].filter(Boolean).join(' ');
      html += `<td><span class="${cls}" data-date="${cell.date}">${cell.day}</span></td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  $('.period-calendar').innerHTML = html;

  // Legend
  let legendHtml = '<div style="display:flex;gap:16px;padding:8px 16px;font-size:12px;color:var(--text2)">';
  legendHtml += '<span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#E91E63;margin-right:4px"></span>经期开始</span>';
  legendHtml += '<span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#FCE4EC;margin-right:4px"></span>经期</span>';
  legendHtml += '</div>';

  // Info card
  let infoHtml = '<div class="period-info-card">';
  if (currentPeriod) {
    const startD = new Date(currentPeriod.startDate + 'T12:00:00');
    const endD = new Date(currentPeriod.endDate + 'T12:00:00');
    const daysPassed = Math.floor((new Date(today + 'T12:00:00') - startD) / 86400000) + 1;
    const totalDays = Math.floor((endD - startD) / 86400000) + 1;
    infoHtml += `<div style="font-size:15px;font-weight:600;color:#C2185B;margin-bottom:8px">经期进行中 · 第${daysPassed}天</div>`;
    infoHtml += `<div style="font-size:13px;color:var(--text2)">${currentPeriod.startDate} ~ ${currentPeriod.endDate}（共${totalDays}天）</div>`;
  } else if (periods.length > 0) {
    const last = periods[periods.length - 1];
    const lastEnd = new Date(last.endDate + 'T12:00:00');
    const todayD = new Date(today + 'T12:00:00');
    const daysSince = Math.floor((todayD - lastEnd) / 86400000);
    infoHtml += `<div style="font-size:15px;font-weight:600;margin-bottom:8px">距上次经期结束 ${daysSince} 天</div>`;
    if (periods.length >= 2) {
      let totalCycle = 0;
      for (let i = 1; i < periods.length; i++) {
        const prev = new Date(periods[i - 1].startDate + 'T12:00:00');
        const curr = new Date(periods[i].startDate + 'T12:00:00');
        totalCycle += Math.floor((curr - prev) / 86400000);
      }
      const avgCycle = Math.round(totalCycle / (periods.length - 1));
      infoHtml += `<div style="font-size:13px;color:var(--text2)">平均周期 ${avgCycle} 天</div>`;
    }
  } else {
    infoHtml += '<div style="font-size:13px;color:var(--text2)">还没有经期记录，点击下方按钮开始记录</div>';
  }
  infoHtml += '</div>';
  $('.period-info').innerHTML = legendHtml + infoHtml;

  // Find the nearest period whose startDate <= selected date (upstream match)
  const nearestPeriod = _selectedDate
    ? [...periods].reverse().find(p => _selectedDate >= p.startDate)
    : null;

  const selLabel = _selectedDate || '请先选择日期';
  const canStart = _selectedDate && !store.isPeriodDay(_selectedDate);
  const canEnd = _selectedDate && nearestPeriod != null;

  let actHtml = `<div class="period-sel-label">已选：${selLabel}</div><div class="period-btn-row">`;
  actHtml += `<button class="btn-period-start" ${canStart ? '' : 'disabled'}>记录经期开始</button>`;
  actHtml += `<button class="btn-period-end" ${canEnd ? '' : 'disabled'} data-start="${nearestPeriod?.startDate || ''}">标记经期结束</button>`;
  actHtml += '</div>';
  $('.period-actions').innerHTML = actHtml;

  // Bind action buttons
  $('.period-actions').querySelector('.btn-period-start').addEventListener('click', () => {
    if (!canStart) return;
    store.addPeriod(_selectedDate);
    _renderPeriodPage();
  });
  $('.period-actions').querySelector('.btn-period-end').addEventListener('click', (e) => {
    if (!canEnd) return;
    store.endPeriodEarly(nearestPeriod.startDate, _selectedDate);
    _renderPeriodPage();
  });

  // Calendar day click = select date (bind on td so the whole cell is clickable)
  $('.period-calendar').querySelectorAll('.pcal-table td').forEach(td => {
    td.addEventListener('click', () => {
      const span = td.querySelector('.pcal-day[data-date]');
      if (!span) return;
      _selectedDate = span.dataset.date;
      _renderPeriodPage();
    });
  });

  // History
  let histHtml = '';
  if (periods.length > 0) {
    histHtml = '<div style="font-size:13px;font-weight:600;color:var(--text2);margin-bottom:8px">历史记录</div>';
    const recent = [...periods].reverse();
    for (const p of recent) {
      const startD = new Date(p.startDate + 'T12:00:00');
      const endD = new Date(p.endDate + 'T12:00:00');
      const days = Math.floor((endD - startD) / 86400000) + 1;
      histHtml += `<div class="ph-item">
        <span class="ph-dates">${p.startDate} ~ ${p.endDate}</span>
        <span class="ph-duration">${days}天</span>
        <button class="ph-del" data-start="${p.startDate}" title="删除">✕</button>
      </div>`;
    }
  }
  $('.period-history').innerHTML = histHtml;
  $('.period-history').querySelectorAll('.ph-del').forEach(btn => {
    btn.addEventListener('click', () => {
      store.deletePeriod(btn.dataset.start);
      _renderPeriodPage();
    });
  });
}

// --- Steps panel ---
let _stepsDate = null;
let _stepsStatsPeriod = 'week';
let _stepsStatsOffset = 0;

function _openSteps() {
  _stepsDate = store.trainingDay();
  $('.steps-panel').style.display = '';
  document.body.style.overflow = 'hidden';
  _renderStepsPage();
}

function _closeSteps() {
  $('.steps-panel').style.display = 'none';
  document.body.style.overflow = '';
  _stepsDate = null;
}

function _saveSteps() {
  const input = $('.steps-input');
  const steps = parseInt(input.value);
  if (isNaN(steps) || steps < 0 || steps > 200000) return;
  store.recordSteps(_stepsDate, steps);
  _renderStepsPage();
  _updateProgressSummary();
}

function _stepsEquiv(steps) {
  if (steps <= 0) return '';
  return `≈ ${(steps * 0.7 / 1000).toFixed(1)} km`;
}

function _renderStepsPage() {
  const date = _stepsDate;
  const currentSteps = store.getStepsForDay(date);
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][new Date(date + 'T12:00:00').getDay()];
  const today = store.trainingDay();
  $('.steps-date-label').textContent = date === today
    ? `今天 · ${date} 周${weekday}`
    : `${date} 周${weekday}`;

  $('.steps-input').value = currentSteps > 0 ? currentSteps : '';

  const summaryEl = $('.steps-summary-display');
  const cal = Math.round(_calcStepsCaloriesRaw(currentSteps));

  if (currentSteps > 0) {
    const prefix = date === today ? '今日' : date.slice(5);
    summaryEl.innerHTML = `
      <div style="margin-bottom:8px">
        <span style="font-size:28px;font-weight:700">${currentSteps.toLocaleString()}</span>
        <span style="font-size:14px;color:var(--text2);margin-left:4px">步</span>
        <span style="font-size:13px;color:var(--text2);margin-left:8px">${_stepsEquiv(currentSteps)}</span>
      </div>
      <div style="font-size:13px;color:var(--text2)">
        ${prefix}步行消耗 <strong style="color:#E65100">🔥 ${cal} kcal</strong>
      </div>`;
  } else {
    summaryEl.innerHTML = `<div style="color:var(--text2)">${date === today ? '今天还没有记录步数' : `${date} 暂无步数记录`}</div>`;
  }

  _renderStepsStats();
}

function _getStepsPeriodDays() {
  if (_stepsStatsPeriod === 'week') return _getWeekDays(_stepsStatsOffset);
  const now = new Date();
  const m = now.getMonth() + _stepsStatsOffset;
  const first = new Date(now.getFullYear(), m, 1);
  const last = new Date(now.getFullYear(), m + 1, 0);
  const days = [];
  for (let d = 1; d <= last.getDate(); d++) days.push(_localDateStr(new Date(now.getFullYear(), m, d)));
  return days;
}

function _getStepsPeriodLabel() {
  if (_stepsStatsPeriod === 'week') return _getWeekLabel(_stepsStatsOffset);
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + _stepsStatsOffset, 1);
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

function _renderStepsStats() {
  const days = _getStepsPeriodDays();
  const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
  const today = store.trainingDay();

  $$('.steps-period-btn').forEach(b => b.classList.toggle('active', b.dataset.period === _stepsStatsPeriod));
  $('.steps-stats-label').textContent = _getStepsPeriodLabel();

  let totalSteps = 0, maxSteps = 0, daysWithData = 0;
  const dayData = [];
  for (const day of days) {
    const steps = store.getStepsForDay(day);
    totalSteps += steps;
    if (steps > maxSteps) maxSteps = steps;
    if (steps > 0) daysWithData++;
    dayData.push({ day, steps });
  }
  const avgSteps = daysWithData > 0 ? Math.round(totalSteps / daysWithData) : 0;
  const totalCal = Math.round(dayData.reduce((t, d) => t + _calcStepsCaloriesRaw(d.steps), 0));
  const totalKm = (totalSteps * 0.7 / 1000).toFixed(1);

  $('.steps-stats-cards').innerHTML = `
    <div class="steps-stat-card"><div class="steps-stat-value">${totalSteps.toLocaleString()}</div><div class="steps-stat-label">总步数</div></div>
    <div class="steps-stat-card"><div class="steps-stat-value" style="color:#E65100">${totalCal}</div><div class="steps-stat-label">消耗 kcal</div></div>
    <div class="steps-stat-card"><div class="steps-stat-value">${avgSteps.toLocaleString()}</div><div class="steps-stat-label">日均步数</div></div>
    <div class="steps-stat-card"><div class="steps-stat-value">${totalKm}</div><div class="steps-stat-label">总距离 km</div></div>`;

  _renderStepsLineChart(dayData);
  _renderStepsBarChart(dayData, maxSteps);

  const dailyEl = $('.steps-stats-daily');
  let html = '';
  for (const d of [...dayData].reverse()) {
    if (d.day > today) continue;
    const wd = dayNames[new Date(d.day + 'T12:00:00').getDay()];
    const cal = Math.round(_calcStepsCaloriesRaw(d.steps));
    const pct = maxSteps > 0 ? Math.round(d.steps / maxSteps * 100) : 0;
    const barColor = d.steps >= 8000 ? '#4CAF50' : d.steps >= 3000 ? '#FF9800' : d.steps > 0 ? '#EF9A9A' : 'transparent';
    html += `<div class="ssd-item ${d.day === _stepsDate ? 'selected' : ''}" data-date="${d.day}">
      <span class="ssd-day">${d.day.slice(5)} 周${wd}</span>
      <span class="ssd-bar-wrap"><span class="ssd-bar" style="width:${pct}%;background:${barColor}"></span></span>
      <span class="ssd-steps">${d.steps > 0 ? d.steps.toLocaleString() : '-'}</span>
      <span class="ssd-cal">${cal > 0 ? cal + ' kcal' : ''}</span>
    </div>`;
  }
  dailyEl.innerHTML = html;
  dailyEl.querySelectorAll('.ssd-item').forEach(item => {
    item.addEventListener('click', () => {
      _stepsDate = item.dataset.date;
      _renderStepsPage();
      $('.steps-panel').scrollTop = 0;
    });
  });
}

function _renderStepsLineChart(dayData) {
  const canvas = $('.steps-line-chart');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  const W = rect.width, H = rect.height;
  ctx.clearRect(0, 0, W, H);

  const pts = dayData.filter(d => d.steps > 0);
  if (pts.length < 2) {
    ctx.fillStyle = '#999';
    ctx.font = '13px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('需要 2 天以上数据显示曲线', W / 2, H / 2);
    return;
  }

  const pad = { top: 20, right: 12, bottom: 38, left: 40 };
  const cw = W - pad.left - pad.right;
  const ch = H - pad.top - pad.bottom;

  const vals = pts.map(d => d.steps);
  let minV = Math.min(...vals);
  let maxV = Math.max(...vals);
  if (maxV - minV < 100) { minV -= 100; maxV += 100; }
  const range = maxV - minV || 1;

  const toX = i => pad.left + (i / (pts.length - 1)) * cw;
  const toY = v => pad.top + (1 - (v - minV) / range) * ch;

  // Grid lines + Y axis labels
  ctx.strokeStyle = '#eee';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (i / 4) * ch;
    const val = maxV - (i / 4) * range;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    ctx.fillStyle = '#999';
    ctx.font = '10px system-ui';
    ctx.textAlign = 'right';
    const label = val >= 1000 ? `${(val / 1000).toFixed(1)}k` : Math.round(val);
    ctx.fillText(label, pad.left - 4, y + 3);
  }

  // Average line
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const avgY = toY(avg);
  ctx.strokeStyle = 'rgba(0,122,255,0.25)';
  ctx.setLineDash([4, 3]);
  ctx.beginPath(); ctx.moveTo(pad.left, avgY); ctx.lineTo(W - pad.right, avgY); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(0,122,255,0.45)';
  ctx.font = '10px system-ui';
  ctx.textAlign = 'left';
  ctx.fillText(`均 ${Math.round(avg).toLocaleString()}`, pad.left + 4, avgY - 4);

  // Area fill
  ctx.globalAlpha = 0.1;
  ctx.fillStyle = '#4CAF50';
  ctx.beginPath();
  ctx.moveTo(toX(0), toY(pts[0].steps));
  for (let i = 1; i < pts.length; i++) ctx.lineTo(toX(i), toY(pts[i].steps));
  ctx.lineTo(toX(pts.length - 1), pad.top + ch);
  ctx.lineTo(toX(0), pad.top + ch);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  // Line
  ctx.strokeStyle = '#4CAF50';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(toX(0), toY(pts[0].steps));
  for (let i = 1; i < pts.length; i++) ctx.lineTo(toX(i), toY(pts[i].steps));
  ctx.stroke();

  // Dots
  pts.forEach((d, i) => {
    const color = d.steps >= 8000 ? '#4CAF50' : d.steps >= 3000 ? '#FF9800' : '#EF9A9A';
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(toX(i), toY(d.steps), 3.5, 0, Math.PI * 2);
    ctx.fill();
  });

  // Date labels
  ctx.fillStyle = '#999';
  ctx.font = '10px system-ui';
  ctx.textAlign = 'center';
  const wdArr = ['日', '一', '二', '三', '四', '五', '六'];
  const isWeekView = pts.length <= 7;
  const step = Math.max(1, Math.floor(pts.length / 6));
  const _drawDateLabel = (pt, xPos) => {
    if (isWeekView) {
      ctx.fillText(wdArr[new Date(pt.day + 'T12:00:00').getDay()], xPos, H - 18);
      ctx.fillText(pt.day.slice(8), xPos, H - 6);
    } else {
      ctx.fillText(pt.day.slice(5), xPos, H - 8);
    }
  };
  for (let i = 0; i < pts.length; i += step) {
    _drawDateLabel(pts[i], toX(i));
  }
  if (pts.length > 1) {
    _drawDateLabel(pts[pts.length - 1], toX(pts.length - 1));
  }
}

function _renderStepsBarChart(dayData, maxSteps) {
  const canvas = $('.steps-bar-chart');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  const W = rect.width, H = rect.height;
  ctx.clearRect(0, 0, W, H);
  if (!dayData.length || maxSteps === 0) return;

  const pad = { top: 22, right: 8, bottom: 34, left: 8 };
  const cw = W - pad.left - pad.right;
  const ch = H - pad.top - pad.bottom;
  const n = dayData.length;
  const barGap = Math.max(1, Math.min(4, cw / n * 0.15));
  const barW = (cw - barGap * (n - 1)) / n;
  const yMax = Math.ceil(maxSteps / 1000) * 1000 || 1000;
  const today = store.trainingDay();

  for (let i = 0; i < n; i++) {
    const d = dayData[i];
    const x = pad.left + i * (barW + barGap);
    const h = d.steps > 0 ? Math.max(2, ch * d.steps / yMax) : 0;
    const y = pad.top + ch - h;
    const color = d.steps >= 8000 ? '#4CAF50' : d.steps >= 3000 ? '#FF9800' : d.steps > 0 ? '#EF9A9A' : 'transparent';

    if (d.day === today) {
      ctx.fillStyle = 'rgba(0,122,255,0.06)';
      ctx.fillRect(x - 1, pad.top, barW + 2, ch);
    }
    if (h > 0) {
      ctx.fillStyle = color;
      const r = Math.min(3, barW / 2);
      ctx.beginPath();
      ctx.moveTo(x, y + h); ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.lineTo(x + barW - r, y);
      ctx.quadraticCurveTo(x + barW, y, x + barW, y + r);
      ctx.lineTo(x + barW, y + h);
      ctx.closePath(); ctx.fill();
    }
    if (d.steps > 0 && (n <= 7 || d.steps >= yMax * 0.3)) {
      ctx.fillStyle = '#666';
      ctx.font = `${n <= 7 ? 10 : 8}px system-ui`;
      ctx.textAlign = 'center';
      const label = d.steps >= 10000 ? `${(d.steps / 1000).toFixed(0)}k` : d.steps >= 1000 ? `${(d.steps / 1000).toFixed(1)}k` : `${d.steps}`;
      ctx.fillText(label, x + barW / 2, y - 4);
    }
    const dayNum = parseInt(d.day.slice(8));
    const wdNames = ['日', '一', '二', '三', '四', '五', '六'];
    const showLabel = n <= 7 || dayNum === 1 || dayNum % 5 === 0 || i === n - 1;
    if (showLabel) {
      ctx.fillStyle = d.day === today ? '#007AFF' : '#999';
      ctx.font = `${n <= 7 ? 10 : 8}px system-ui`;
      ctx.textAlign = 'center';
      if (n <= 7) {
        ctx.fillText(wdNames[new Date(d.day + 'T12:00:00').getDay()], x + barW / 2, H - 18);
        ctx.fillText(String(dayNum), x + barW / 2, H - 6);
      } else {
        ctx.fillText(String(dayNum), x + barW / 2, H - 6);
      }
    }
  }
}

function _renderStats() {
  const weekDays = _getWeekDays(_weekOffset);
  const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
  const data = store.getAllTrainingData();
  const allExercises = exercises;

  $('.stats-week-label').textContent = _getWeekLabel(_weekOffset);

  // Group exercises by category
  const categories = {};
  for (const ex of allExercises) {
    if (!categories[ex.category]) categories[ex.category] = [];
    categories[ex.category].push(ex);
  }

  // Heatmap header with fixed-width columns; today gets slightly wider
  const todayIdx = weekDays.indexOf(store.trainingDay());
  const dayColPct = 10;
  const todayColPct = 14;
  const nameColPct = 100 - (6 * dayColPct + todayColPct);
  let heatHtml = '<table class="heatmap-table"><colgroup>';
  heatHtml += `<col style="width:${nameColPct}%">`;
  for (let i = 0; i < 7; i++) {
    heatHtml += `<col style="width:${i === todayIdx ? todayColPct : dayColPct}%">`;
  }
  heatHtml += '</colgroup><thead><tr><th class="hm-name-th"></th>';
  for (let i = 0; i < 7; i++) {
    const dateStr = weekDays[i].slice(8);
    const isToday = i === todayIdx;
    const isPeriod = store.isPeriodDay(weekDays[i]);
    const thCls = [isToday ? 'today' : '', isPeriod ? 'period-day' : ''].filter(Boolean).join(' ');
    heatHtml += `<th class="${thCls}">${dayNames[i]}<br><span class="hm-date">${dateStr}</span></th>`;
  }
  heatHtml += '</tr></thead><tbody>';

  const weekStats = {};
  const catStats = {};

  for (const [cat, exs] of Object.entries(categories)) {
    heatHtml += `<tr class="hm-cat-row"><td colspan="8" class="hm-cat">${cat}</td></tr>`;
    let catCount = 0;

    for (const ex of exs) {
      heatHtml += `<tr><td class="hm-name">${ex.name}</td>`;
      let exWeekCount = 0, exWeekReps = 0, exWeekHold = 0;

      for (let i = 0; i < 7; i++) {
        const dayKey = weekDays[i];
        const sessions = (data[dayKey] || {})[ex.id] || [];
        const checked = (() => {
          try {
            return !!store.getDayChecks(dayKey)[ex.id];
          } catch { return false; }
        })();

        const count = sessions.length;
        const reps = sessions.reduce((s, e) => s + (e.totalReps || 0), 0);
        const hold = sessions.reduce((s, e) => s + (e.holdSeconds || 0), 0);
        const checkCount = store.getCheckCount(ex.id, dayKey);
        exWeekCount += count + (checkCount > 0 ? checkCount : 0);
        exWeekReps += reps;
        exWeekHold += hold;

        const ratio = _completionRatio(ex, reps, hold, checked, checkCount);
        const isToday = weekDays[i] === store.trainingDay();
        const tooltip = ex.dailyCheckTarget
          ? (checkCount > 0 ? `打卡 ${checkCount}/${ex.dailyCheckTarget} (${Math.round(ratio * 100)}%)` : '')
          : count > 0
            ? `${count}次${reps ? ' ' + reps + '次' : ''}${hold ? ' ' + hold + '秒' : ''} (${Math.round(ratio * 100)}%)`
            : checked ? '已打勾 (100%)' : '';

        heatHtml += `<td class="hm-cell ${isToday ? 'today' : ''}" data-day="${dayKey}" title="${tooltip}">`;
        heatHtml += _renderHeatDot(ratio);
        heatHtml += `</td>`;
      }
      heatHtml += '</tr>';
      catCount += exWeekCount;
      weekStats[ex.id] = { count: exWeekCount, reps: exWeekReps, hold: exWeekHold, name: ex.name, mode: ex.mode, category: cat };
    }
    catStats[cat] = catCount;
  }
  heatHtml += '</tbody></table>';
  $('.stats-heatmap').innerHTML = heatHtml;

  // Weekly calorie summary with breakdown
  let weekCal = 0, weekStepsCal = 0, weekSteps = 0;
  const dayCals = [];
  for (let i = 0; i < 7; i++) {
    const dc = _calcDayCalories(weekDays[i]);
    dayCals.push(dc);
    weekCal += dc;
    const s = store.getStepsForDay(weekDays[i]);
    weekSteps += s;
    weekStepsCal += Math.round(_calcStepsCaloriesRaw(s));
  }
  const weekExCal = weekCal - weekStepsCal;
  const avgWeekSteps = Math.round(weekSteps / 7);

  let sumHtml = `<div class="stats-cal-banner">
    <div class="stats-cal-total-row">
      <span class="stats-cal-icon">🔥</span>
      <span class="stats-cal-total">本周总消耗 ${weekCal} kcal</span>
      <span class="stats-cal-ref">${_calEquiv(weekCal)}</span>
    </div>
    <div class="stats-cal-breakdown">
      <div class="stats-cal-sub">
        <span class="stats-cal-sub-icon">💪</span>
        <span class="stats-cal-sub-label">健身</span>
        <span class="stats-cal-sub-val">${weekExCal} kcal</span>
        <span class="stats-cal-sub-ref">${_calEquiv(weekExCal)}</span>
      </div>
      <div class="stats-cal-sub">
        <span class="stats-cal-sub-icon">👟</span>
        <span class="stats-cal-sub-label">步行</span>
        <span class="stats-cal-sub-val">${weekStepsCal} kcal</span>
        <span class="stats-cal-sub-ref">${_calEquiv(weekStepsCal)}</span>
      </div>
    </div>
    ${weekSteps > 0 ? `<div class="stats-cal-steps-row">本周 ${weekSteps.toLocaleString()} 步 · 日均 ${avgWeekSteps.toLocaleString()} 步</div>` : ''}
    <div class="stats-cal-days">${dayCals.map((c, i) => c > 0 ? `${dayNames[i]} ${c}` : '').filter(Boolean).join(' · ')}</div>
  </div>`;

  // Weekly summary — grouped by category
  for (const [cat, exs] of Object.entries(categories)) {
    const catExStats = exs.map(ex => weekStats[ex.id]).filter(s => s.count > 0);
    if (catExStats.length === 0) continue;

    sumHtml += `<div class="stats-cat-title">${cat} · 本周 ${catStats[cat]} 次</div>`;
    sumHtml += '<div class="stats-cards">';
    for (const s of catExStats) {
      const metric = s.reps > 0 ? `${s.reps} 次` : s.hold > 0 ? `${s.hold} 秒` : '';
      sumHtml += `
        <div class="stats-card">
          <div class="stats-card-name">${s.name}</div>
          <div class="stats-card-count">${s.count} 次训练</div>
          ${metric ? `<div class="stats-card-metric">${metric}</div>` : ''}
        </div>`;
    }
    sumHtml += '</div>';
  }
  if (weekCal === 0 && !Object.values(catStats).some(c => c > 0)) {
    sumHtml += '<div class="stats-empty">本周暂无训练记录</div>';
  }
  $('.stats-summary').innerHTML = sumHtml;

  // Day detail: clicking a heatmap cell shows that day's sessions
  $('.stats-heatmap').querySelectorAll('.hm-cell[data-day]').forEach(cell => {
    cell.addEventListener('click', () => _renderDayDetail(cell.dataset.day));
  });

  // Show today's detail by default
  _renderDayDetail(store.trainingDay());
}

function _renderDayDetail(day) {
  const container = $('.stats-day-detail');
  const data = store.getAllTrainingData();
  const dayData = data[day] || {};
  const exerciseMap = {};
  for (const ex of exercises) exerciseMap[ex.id] = ex.name;

  const weekday = ['日', '一', '二', '三', '四', '五', '六'][new Date(day + 'T12:00:00').getDay()];
  const dayCal = _calcDayCalories(day);
  const dayStepsCal = Math.round(_calcStepsCaloriesRaw(store.getStepsForDay(day)));
  const dayExCal = dayCal - dayStepsCal;
  let calStr = '';
  if (dayCal > 0) {
    calStr = ` · 🔥 ${dayCal} kcal ${_calEquiv(dayCal)}`;
    const parts = [];
    if (dayExCal > 0) parts.push(`💪${dayExCal}`);
    if (dayStepsCal > 0) parts.push(`👟${dayStepsCal}`);
    if (parts.length === 2) calStr += ` (${parts.join(' + ')})`;
  }
  let html = `<div class="detail-day-title">${day} 周${weekday}${calStr}</div>`;

  let sessions = [];
  for (const [exId, list] of Object.entries(dayData)) {
    for (const s of list) {
      sessions.push({ ...s, exId, exName: exerciseMap[exId] || exId });
    }
  }
  sessions.sort((a, b) => (a.time || '').localeCompare(b.time || ''));

  if (sessions.length === 0) {
    html += '<div class="detail-empty">当日无训练记录</div>';
  } else {
    for (const s of sessions) {
      const detail = s.totalReps ? `${s.totalReps}次` : s.holdSeconds ? `${s.holdSeconds}秒` : '';
      const dm = s.durationSeconds ? `${Math.floor(s.durationSeconds / 60)}分${s.durationSeconds % 60}秒` : '';
      const kind = s.sessionKind || '完成';
      html += `
        <div class="detail-row">
          <span class="detail-time">${s.time || ''}</span>
          <span class="detail-name">${s.exName}</span>
          <span class="detail-metric">${detail}</span>
          <span class="detail-dur">${dm}</span>
          <span class="detail-kind ${kind === '完成' ? 'done' : 'stopped'}">${kind}</span>
        </div>`;
    }
  }

  // Also show checklist items
  try {
    const checks = store.getDayChecks(day);
    const checkedIds = Object.keys(checks);
  } catch {}

  container.innerHTML = html;
}

// --- Init ---
function _formatDate() {
  const d = new Date();
  const days = ['日', '一', '二', '三', '四', '五', '六'];
  return `${d.getMonth() + 1}月${d.getDate()}日 周${days[d.getDay()]}`;
}

export function init() {
  $('.date-display').textContent = _formatDate();

  // Auto-refresh date & list when day changes or page regains focus
  let _lastDay = new Date().getDate();
  const _checkDayChange = () => {
    const now = new Date();
    if (now.getDate() !== _lastDay) {
      _lastDay = now.getDate();
      $('.date-display').textContent = _formatDate();
      renderList();
    }
  };
  setInterval(_checkDayChange, 30000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) _checkDayChange();
  });

  // Mute toggle
  $('.btn-mute').addEventListener('click', () => {
    const muted = !voice.isMuted();
    voice.setMuted(muted);
    $('.btn-mute').innerHTML = muted
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';
    $('.btn-mute').classList.toggle('active', muted);
  });

  // Group toggle
  $$('.group-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _groupMode = btn.dataset.group;
      $$('.group-btn').forEach(b => b.classList.toggle('active', b === btn));
      renderList();
    });
  });

  // Period button
  $('.btn-period')?.addEventListener('click', () => _openPeriod());
  $('.period-back')?.addEventListener('click', () => _closePeriod());
  $('.period-prev')?.addEventListener('click', () => { _periodMonthOffset--; _renderPeriodPage(); });
  $('.period-next')?.addEventListener('click', () => { _periodMonthOffset++; _renderPeriodPage(); });

  // Weight button
  $('.btn-weight')?.addEventListener('click', () => _openWeight());
  $('.weight-back')?.addEventListener('click', () => _closeWeight());
  $('.weight-save')?.addEventListener('click', () => _saveWeight());
  $('.weight-input')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') _saveWeight(); });

  // Steps button
  $('.btn-steps')?.addEventListener('click', () => _openSteps());
  $('.steps-back')?.addEventListener('click', () => _closeSteps());
  $('.steps-save')?.addEventListener('click', () => _saveSteps());
  $('.steps-input')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') _saveSteps(); });
  $('.steps-date-prev')?.addEventListener('click', () => {
    const d = new Date(_stepsDate + 'T12:00:00');
    d.setDate(d.getDate() - 1);
    _stepsDate = _localDateStr(d);
    _renderStepsPage();
  });
  $('.steps-date-next')?.addEventListener('click', () => {
    const d = new Date(_stepsDate + 'T12:00:00');
    d.setDate(d.getDate() + 1);
    if (_localDateStr(d) <= store.trainingDay()) {
      _stepsDate = _localDateStr(d);
      _renderStepsPage();
    }
  });

  // Steps stats period toggle & nav
  $$('.steps-period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _stepsStatsPeriod = btn.dataset.period;
      _stepsStatsOffset = 0;
      _renderStepsStats();
    });
  });
  $('.steps-stats-prev')?.addEventListener('click', () => { _stepsStatsOffset--; _renderStepsStats(); });
  $('.steps-stats-next')?.addEventListener('click', () => {
    if (_stepsStatsOffset < 0) { _stepsStatsOffset++; _renderStepsStats(); }
  });

  // Stats button
  $('.btn-export')?.addEventListener('click', () => _openStats());

  // Stats panel controls
  $('.stats-back')?.addEventListener('click', () => _closeStats());
  $('.stats-export')?.addEventListener('click', () => store.exportCSV());
  $('.stats-prev')?.addEventListener('click', () => { _weekOffset--; _renderStats(); });
  $('.stats-next')?.addEventListener('click', () => {
    if (_weekOffset < 0) { _weekOffset++; _renderStats(); }
  });

  // Training overlay controls
  $('.btn-pause').addEventListener('click', () => engine.pause());
  $('.btn-resume').addEventListener('click', () => engine.resume());
  $('.btn-stop').addEventListener('click', () => {
    if (!confirm('确定要结束训练吗？已完成的进度会保存。')) return;
    engine.cancel();
    _closeOverlay();
  });

  window.addEventListener('beforeunload', () => {
    if (engine.isRunning()) engine.cancel();
  });

  const uid = store.getUserId();
  const badge = document.getElementById('user-badge');
  if (badge && uid !== 'default') {
    badge.textContent = `· ${uid}`;
    badge.style.cssText = 'background:var(--accent);color:#fff;padding:1px 8px;border-radius:10px;font-size:11px;margin-left:4px;vertical-align:middle';
  }

  renderList();

  store.syncFromCloud().then(() => renderList());

  // Preload common voice clips
  const commonUrls = [];
  for (const dir of ['../trainer_tts', '../hyoid_tts']) {
    for (let i = 1; i <= 20; i++) {
      commonUrls.push(`${dir}/num_${String(i).padStart(2, '0')}.wav`);
    }
  }
  commonUrls.push('../trainer_tts/start.wav', '../trainer_tts/ready.wav', '../trainer_tts/done_good.wav');
  commonUrls.push('../hyoid_tts/start.wav', '../hyoid_tts/ready.wav', '../hyoid_tts/done_good.wav');
  voice.preload(commonUrls);

  // Adapt theme-color meta for dark mode
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const updateThemeColor = () => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = mq.matches ? '#1C1C1E' : '#007AFF';
  };
  updateThemeColor();
  mq.addEventListener('change', updateThemeColor);
}
