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

// --- History panel ---
function _openHistory() {
  const panel = $('.history-panel');
  panel.style.display = '';
  const content = $('.history-content');
  const days = store.getAllDays().reverse();

  if (days.length === 0) {
    content.innerHTML = '<div class="history-empty">暂无训练记录</div>';
    return;
  }

  const exerciseMap = {};
  for (const ex of exercises) exerciseMap[ex.id] = ex.name;

  let html = '';
  for (const day of days) {
    let daySessions = [];
    const data = JSON.parse(localStorage.getItem('fitness_training_data') || '{}');
    const dayData = data[day] || {};

    for (const [exId, sessions] of Object.entries(dayData)) {
      for (const s of sessions) {
        daySessions.push({ ...s, exId, exName: exerciseMap[exId] || exId });
      }
    }

    daySessions.sort((a, b) => (a.time || '').localeCompare(b.time || ''));

    html += `<div class="history-day">`;
    html += `<div class="history-day-header">${day}</div>`;

    for (const s of daySessions) {
      const kindClass = s.sessionKind === '完成' ? 'done' : 'cancelled';
      const detail = s.totalReps
        ? `${s.totalReps}次`
        : s.holdSeconds
          ? `${s.holdSeconds}秒`
          : '';
      const duration = s.durationSeconds
        ? `${Math.floor(s.durationSeconds / 60)}分${s.durationSeconds % 60}秒`
        : '';

      html += `
        <div class="history-session">
          <span class="history-session-time">${s.time || ''}</span>
          <span class="history-session-name">${s.exName}</span>
          <span class="history-session-detail">${detail} ${duration}</span>
          <span class="history-session-kind ${kindClass}">${s.sessionKind || ''}</span>
        </div>`;
    }
    html += `</div>`;
  }
  content.innerHTML = html;
}

function _closeHistory() {
  $('.history-panel').style.display = 'none';
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

  // Export button → open history
  $('.btn-export')?.addEventListener('click', () => _openHistory());

  // History panel controls
  $('.history-back')?.addEventListener('click', () => _closeHistory());
  $('.history-export')?.addEventListener('click', () => store.exportCSV());

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
