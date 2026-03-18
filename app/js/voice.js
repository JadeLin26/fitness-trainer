// Shared voice playback system using Web Audio API + Web Speech API fallback.

const _audioCtx = () => new (window.AudioContext || window.webkitAudioContext)();
const _bufferCache = new Map();
let _ctx = null;
let _queue = [];
let _playing = false;
let _muted = false;

function _ensureCtx() {
  if (!_ctx || _ctx.state === 'closed') _ctx = _audioCtx();
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

function _trimSilence(buf) {
  const ch = buf.getChannelData(0);
  const rate = buf.sampleRate;
  const threshold = 0.005;
  let end = ch.length - 1;
  while (end > 0 && Math.abs(ch[end]) < threshold) end--;
  end = Math.min(ch.length, end + Math.floor(rate * 0.05));
  if (end >= ch.length - rate * 0.1) return buf;
  const ctx = _ensureCtx();
  const trimmed = ctx.createBuffer(buf.numberOfChannels, end, rate);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    trimmed.getChannelData(c).set(buf.getChannelData(c).subarray(0, end));
  }
  return trimmed;
}

async function _loadBuffer(url) {
  if (_bufferCache.has(url)) return _bufferCache.get(url);
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    let buf = await _ensureCtx().decodeAudioData(await res.arrayBuffer());
    if (/num_\d+\.wav$/.test(url) && buf.duration > 2) {
      buf = _trimSilence(buf);
    }
    _bufferCache.set(url, buf);
    return buf;
  } catch { return null; }
}

function _playBuffer(buf) {
  return new Promise(resolve => {
    const ctx = _ensureCtx();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.onended = resolve;
    src.start();
  });
}

function _speakTTS(text) {
  return new Promise(resolve => {
    if (!window.speechSynthesis) { resolve(); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    u.rate = 1.1;
    u.onend = resolve;
    u.onerror = resolve;
    speechSynthesis.speak(u);
  });
}

// Beep using oscillator
export function beep(freq = 800, dur = 150) {
  if (_muted) return;
  try {
    const ctx = _ensureCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.type = 'sine';
    gain.gain.value = 0.25;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur / 1000);
    setTimeout(() => { osc.stop(); ctx.close(); }, dur + 50);
  } catch {}
}

// Preload a list of WAV URLs in the background
export function preload(urls) {
  urls.forEach(u => _loadBuffer(u));
}

// Play a single WAV file by URL, with optional minimum duration padding
export async function playWav(url, minDurationMs = 0) {
  if (_muted) return;
  const buf = await _loadBuffer(url);
  if (!buf) return;
  await _playBuffer(buf);
  const actualMs = buf.duration * 1000;
  if (minDurationMs > 0 && actualMs < minDurationMs) {
    await sleep(minDurationMs - actualMs);
  }
}

// Play a WAV key from a TTS directory
export async function playKey(ttsDir, key, minDurationMs = 0) {
  const url = `${ttsDir}/${key}.wav`;
  await playWav(url, minDurationMs);
}

// Play a number (1-30) from the given TTS directory
export async function playNum(ttsDir, n, minDurationMs = 820) {
  const key = `num_${String(n).padStart(2, '0')}`;
  await playKey(ttsDir, key, minDurationMs);
}

// Speak text: try WAV first, fallback to Web Speech API
export async function say(ttsDir, ttsMap, text) {
  if (_muted) return;
  if (ttsMap && ttsMap[text]) {
    await playKey(ttsDir, ttsMap[text]);
    return;
  }
  await _speakTTS(text);
}

// Non-blocking speak
export function sayAsync(ttsDir, ttsMap, text) {
  say(ttsDir, ttsMap, text);
}

export function setMuted(m) { _muted = m; }
export function isMuted() { return _muted; }

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
