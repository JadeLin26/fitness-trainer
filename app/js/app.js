// Main app — renders exercise list, handles UI interactions, drives training overlay.

import { exercises, getExercise, getTrainableExercises } from './exercises.js';
import * as engine from './engine.js';
import * as store from './store.js';
import * as voice from './voice.js';

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

const ICONS = {
  posture: '🧍',
  hyoid: '🫁',
  auxiliary: '💪',
};

let _expandedId = null;

// --- Render exercise list ---
function renderList() {
  const list = $('.exercise-list');
  const day = store.trainingDay();
  const categories = {};

  for (const ex of exercises) {
    if (!categories[ex.category]) categories[ex.category] = [];
    categories[ex.category].push(ex);
  }

  let html = '';
  for (const [cat, exs] of Object.entries(categories)) {
    html += `<div class="category-header">${cat}</div>`;
    for (const ex of exs) {
      const checked = store.isChecked(ex.id, day);
      const expanded = _expandedId === ex.id;
      const params = _renderParams(ex);
      const hasVideo = ex.video && ex.video !== null;

      html += `
        <div class="ex-card ${expanded ? 'expanded' : ''}" data-id="${ex.id}">
          <div class="ex-card-header" data-id="${ex.id}" role="button" tabindex="0" aria-expanded="${expanded}">
            <div class="ex-card-icon ${ex.categoryTag}">${ICONS[ex.categoryTag] || '🏋️'}</div>
            <div class="ex-card-info">
              <div class="ex-card-name">${ex.name}</div>
              <div class="ex-card-sub">${ex.subtitle}</div>
            </div>
            <div class="ex-card-status">
              <div class="check-mark ${checked ? 'done' : ''}">✓</div>
              <span class="expand-arrow">›</span>
            </div>
          </div>
          ${ex.mode ? `
          <div class="ex-card-detail">
            <div class="ex-detail-inner">
              <div class="ex-desc">${ex.description}</div>
              ${ex.tips ? `<div class="ex-tips">${ex.tips}</div>` : ''}
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

function _toggleCard(id) {
  _expandedId = _expandedId === id ? null : id;
  renderList();
}

// --- Progress summary ---
function _updateProgressSummary() {
  const day = store.trainingDay();
  const trainable = getTrainableExercises();
  let done = 0;
  for (const ex of trainable) {
    if (store.isChecked(ex.id, day)) done++;
  }
  const total = trainable.length;
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

  // Wall angel daily target
  const waReps = store.getDayTotalReps('wall_angel', day);
  const waTarget = getExercise('wall_angel')?.dailyTarget || 360;
  const waPct = Math.min(100, Math.round(waReps / waTarget * 100));
  const waEl = $('.wa-progress');
  if (waEl) {
    waEl.textContent = `靠墙天使 ${waReps}/${waTarget} (${waPct}%)`;
  }
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
    labelEl.textContent = info.totalSets > 1
      ? `第${info.set}组 / ${info.totalReps}次`
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
    labelEl.textContent = info.totalSets > 1
      ? `第${info.set}组 第${info.rep}次`
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
  _renderStats();
}

function _closeStats() {
  $('.stats-panel').style.display = 'none';
  _weekOffset = 0;
}

function _renderStats() {
  const weekDays = _getWeekDays(_weekOffset);
  const dayNames = ['一', '二', '三', '四', '五', '六', '日'];
  const data = JSON.parse(localStorage.getItem('fitness_training_data') || '{}');
  const allExercises = exercises;

  $('.stats-week-label').textContent = _getWeekLabel(_weekOffset);

  // Heatmap: 7 columns (days) × exercise rows
  let heatHtml = '<table class="heatmap-table"><thead><tr><th></th>';
  for (let i = 0; i < 7; i++) {
    const dateStr = weekDays[i].slice(8);
    const isToday = weekDays[i] === store.trainingDay();
    heatHtml += `<th class="${isToday ? 'today' : ''}">${dayNames[i]}<br><span class="hm-date">${dateStr}</span></th>`;
  }
  heatHtml += '</tr></thead><tbody>';

  const weekStats = {};

  for (const ex of allExercises) {
    heatHtml += `<tr><td class="hm-name">${ex.name.length > 6 ? ex.name.slice(0, 6) + '…' : ex.name}</td>`;
    let exWeekCount = 0;
    let exWeekReps = 0;
    let exWeekHold = 0;

    for (let i = 0; i < 7; i++) {
      const dayKey = weekDays[i];
      const sessions = (data[dayKey] || {})[ex.id] || [];
      const checked = (() => {
        try {
          const ck = JSON.parse(localStorage.getItem(`fitness_check_${dayKey}`) || '{}');
          return !!ck[ex.id];
        } catch { return false; }
      })();

      const count = sessions.length;
      const reps = sessions.reduce((s, e) => s + (e.totalReps || 0), 0);
      const hold = sessions.reduce((s, e) => s + (e.holdSeconds || 0), 0);

      exWeekCount += count;
      exWeekReps += reps;
      exWeekHold += hold;

      let level = 0;
      if (checked || count > 0) level = 1;
      if (count >= 2) level = 2;
      if (count >= 3) level = 3;

      const isToday = weekDays[i] === store.trainingDay();
      const tooltip = count > 0
        ? `${count}次${reps ? ' ' + reps + '次动作' : ''}${hold ? ' ' + hold + '秒' : ''}`
        : checked ? '已打勾' : '';

      heatHtml += `<td class="hm-cell level-${level} ${isToday ? 'today' : ''}" data-day="${dayKey}" title="${tooltip}">`;
      if (level > 0) heatHtml += `<span class="hm-dot"></span>`;
      heatHtml += `</td>`;
    }
    heatHtml += '</tr>';

    weekStats[ex.id] = { count: exWeekCount, reps: exWeekReps, hold: exWeekHold, name: ex.name, mode: ex.mode };
  }
  heatHtml += '</tbody></table>';
  $('.stats-heatmap').innerHTML = heatHtml;

  // Weekly summary cards
  let sumHtml = '<div class="stats-cards">';
  for (const [id, s] of Object.entries(weekStats)) {
    if (s.count === 0 && !s.mode) continue;
    const metric = s.reps > 0 ? `${s.reps} 次` : s.hold > 0 ? `${s.hold} 秒` : '';
    sumHtml += `
      <div class="stats-card">
        <div class="stats-card-name">${s.name}</div>
        <div class="stats-card-count">${s.count} 次训练</div>
        ${metric ? `<div class="stats-card-metric">${metric}</div>` : ''}
      </div>`;
  }
  if (Object.values(weekStats).every(s => s.count === 0)) {
    sumHtml += '<div class="stats-empty">本周暂无训练记录</div>';
  }
  sumHtml += '</div>';
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
    if (checkedIds.length > 0) {
      html += '<div class="detail-checks-title">打勾完成</div>';
      for (const id of checkedIds) {
        html += `<div class="detail-check-row">✓ ${exerciseMap[id] || id}</div>`;
      }
    }
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
