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
  '姿势矫正': 'icons/icon_posture.png',
  '辅助训练': 'icons/icon_auxiliary.png',
  '骨盆前倾矫正': 'icons/icon_pelvis.png',
  '圆肩驼背矫正': 'icons/icon_back.png',
};

const EX_ICON_FILES = {
  'pelvic_breath': 'icons/icon_pelvic_breath.png',
  'pelvic_tilt': 'icons/icon_pelvic_tilt.png',
  'hip_flexor_stretch': 'icons/icon_hip_flexor.png',
  'single_leg_lower': 'icons/icon_core.png',
  'single_glute_bridge': 'icons/icon_glute.png',
  'single_leg_deadlift': 'icons/icon_hamstring.png',
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

      html += `
        <div class="ex-card ${expanded ? 'expanded' : ''}" data-id="${ex.id}">
          <div class="ex-card-header" data-id="${ex.id}" role="button" tabindex="0" aria-expanded="${expanded}">
            <div class="ex-card-icon" data-cat="${ex.category}">${_getExIcon(ex.id, ex.category)}</div>
            <div class="ex-card-info">
              <div class="ex-card-name">${ex.name}</div>
              <div class="ex-card-sub">${_renderCardSummary(ex)}</div>
            </div>
            <div class="ex-card-status">
              ${_renderCheckRing(pct)}
              <span class="expand-arrow">›</span>
            </div>
          </div>
          ${ex.mode ? `
          <div class="ex-card-detail">
            <div class="ex-detail-inner">
              <div class="ex-desc">${ex.description}</div>
              ${ex.tips ? `<div class="ex-tips">${ex.tips}</div>` : ''}
              ${ex.alternating ? `<div class="ex-alternating">🔄 奇数组左腿，偶数组右腿（语音会自动提示）</div>` : ''}
              ${params ? `<div class="ex-params">${params}</div>` : ''}
              ${hasVideo ? `<video class="ex-video" src="${ex.video}" controls preload="none" playsinline></video>` : ''}
              <button class="btn-start" data-id="${ex.id}">开始训练</button>
            </div>
          </div>` : `
          <div class="ex-card-detail">
            <div class="ex-detail-inner">
              <div class="ex-desc">${ex.description}</div>
              ${ex.tips ? `<div class="ex-tips">${ex.tips.replace(/\n/g, '<br>')}</div>` : ''}
              ${ex.externalVideo ? `<a class="btn-video-link" href="${ex.externalVideo}" target="_blank" rel="noopener">📺 打开跟练视频</a>` : ''}
              <button class="btn-check" data-id="${ex.id}">✓ 打勾完成</button>
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

function _completionRatio(ex, dayReps, dayHold, checked) {
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
  const full = ratio >= 1;
  if (full) {
    return `<span class="hm-full">✓</span>`;
  }
  const R = 10;
  const r = Math.sqrt(ratio) * R;
  return `<svg class="hm-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="${r.toFixed(1)}" fill="#4CAF50" opacity="0.7"/></svg>`;
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
  return store.isChecked(ex.id, day);
}

function _exProgress(ex, day) {
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

function _renderCheckRing(pct) {
  if (pct >= 1) {
    return `<span class="ring-pct green">100%</span><div class="check-ring full">✓</div>`;
  }
  if (pct <= 0) {
    return `<span class="ring-pct red">0%</span><div class="check-ring"></div>`;
  }
  const deg = Math.round(pct * 360);
  return `<span class="ring-pct yellow">${Math.round(pct * 100)}%</span><div class="check-ring partial" style="background:conic-gradient(var(--green) ${deg}deg, var(--border) ${deg}deg)"></div>`;
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
  $('.progress-label').textContent = `今日完成 ${pct}%`;

  const circ = 2 * Math.PI * 18;
  const offset = circ * (1 - pct / 100);
  const fg = $('.summary-ring-fg');
  if (fg) {
    fg.style.strokeDasharray = `${circ}`;
    fg.style.strokeDashoffset = `${offset}`;
  }

  const waEl = $('.wa-progress');
  if (waEl) waEl.textContent = '';
}

// --- Training overlay ---
function _startTraining(ex) {
  const overlay = $('.training-overlay');
  overlay.classList.add('active');
  $('.training-title').textContent = ex.name;
  $('.training-subtitle').textContent = ex.tips || ex.subtitle;

  const btnPause = $('.btn-pause');
  const btnStop = $('.btn-stop');
  const btnResume = $('.btn-resume');
  btnPause.style.display = '';
  btnResume.style.display = 'none';

  engine.startExercise(ex, info => {
    _updateTrainingUI(info, ex);
  });
}

function _updateTrainingUI(info, ex) {
  const numEl = $('.ring-number');
  const labelEl = $('.ring-label');
  const progressEl = $('.training-progress-text');
  const fg = $('.ring-timer-fg');
  const circ = 2 * Math.PI * 100;

  if (!numEl) return;

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
    labelEl.textContent = info.totalSets > 1
      ? `第${info.set}组${sideTag} 第${info.rep}次`
      : `第${info.rep || 1}次`;
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
    setTimeout(() => _closeOverlay(), 2500);
  }
  else if (info.phase === 'cancelled') {
    _closeOverlay();
  }
}

function _closeOverlay() {
  $('.training-overlay').classList.remove('active');
  $('.ring-number').style.color = '';
  engine.reset();
  renderList();
}

// --- Stats panel ---
let _weekOffset = 0;

function _getWeekDays(offset = 0) {
  const now = new Date();
  const day = now.getDay() || 7;
  const mon = new Date(now);
  mon.setDate(now.getDate() - day + 1 + offset * 7);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    days.push(d.toISOString().slice(0, 10));
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

function _renderStats() {
  const weekDays = _getWeekDays(_weekOffset);
  const dayNames = ['一', '二', '三', '四', '五', '六', '日'];
  const data = JSON.parse(localStorage.getItem('fitness_training_data') || '{}');
  const allExercises = exercises;

  $('.stats-week-label').textContent = _getWeekLabel(_weekOffset);

  // Group exercises by category
  const categories = {};
  for (const ex of allExercises) {
    if (!categories[ex.category]) categories[ex.category] = [];
    categories[ex.category].push(ex);
  }

  // Heatmap header
  let heatHtml = '<table class="heatmap-table"><thead><tr><th class="hm-name-th"></th>';
  for (let i = 0; i < 7; i++) {
    const dateStr = weekDays[i].slice(8);
    const isToday = weekDays[i] === store.trainingDay();
    heatHtml += `<th class="${isToday ? 'today' : ''}">${dayNames[i]}<br><span class="hm-date">${dateStr}</span></th>`;
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
            return !!JSON.parse(localStorage.getItem(`fitness_check_${dayKey}`) || '{}')[ex.id];
          } catch { return false; }
        })();

        const count = sessions.length;
        const reps = sessions.reduce((s, e) => s + (e.totalReps || 0), 0);
        const hold = sessions.reduce((s, e) => s + (e.holdSeconds || 0), 0);
        exWeekCount += count;
        exWeekReps += reps;
        exWeekHold += hold;

        const ratio = _completionRatio(ex, reps, hold, checked);
        const isToday = weekDays[i] === store.trainingDay();
        const tooltip = count > 0
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

  // Weekly summary — grouped by category
  let sumHtml = '';
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
  if (!sumHtml) {
    sumHtml = '<div class="stats-empty">本周暂无训练记录</div>';
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
  const data = JSON.parse(localStorage.getItem('fitness_training_data') || '{}');
  const dayData = data[day] || {};
  const exerciseMap = {};
  for (const ex of exercises) exerciseMap[ex.id] = ex.name;

  const weekday = ['日', '一', '二', '三', '四', '五', '六'][new Date(day + 'T12:00:00').getDay()];
  let html = `<div class="detail-day-title">${day} 周${weekday}</div>`;

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
    const checks = JSON.parse(localStorage.getItem(`fitness_check_${day}`) || '{}');
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

  // Mute toggle
  $('.btn-mute').addEventListener('click', () => {
    const muted = !voice.isMuted();
    voice.setMuted(muted);
    $('.btn-mute').textContent = muted ? '🔇' : '🔊';
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
    engine.cancel();
    _closeOverlay();
  });

  renderList();

  store.syncFromCloud().then(() => renderList());

  // Preload common voice clips
  const commonUrls = [];
  for (let i = 1; i <= 20; i++) {
    commonUrls.push(`../trainer_tts/num_${String(i).padStart(2, '0')}.wav`);
  }
  commonUrls.push('../trainer_tts/start.wav', '../trainer_tts/ready.wav', '../trainer_tts/done_good.wav');
  voice.preload(commonUrls);
}
