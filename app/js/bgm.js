// BGM player using Web Audio API for gapless looping.

let _ctx = null;
let _buffer = null;
let _source = null;
let _gain = null;
let _playing = false;

async function _ensureContext() {
  if (!_ctx) _ctx = new AudioContext();
  if (_ctx.state === 'suspended') await _ctx.resume();
  return _ctx;
}

async function _loadBuffer(url) {
  const ctx = await _ensureContext();
  const res = await fetch(url);
  const arrayBuf = await res.arrayBuffer();
  return ctx.decodeAudioData(arrayBuf);
}

export async function start(url = '../trainer_tts/bgm_beat.wav', volume = 0.18) {
  stop();
  try {
    const ctx = await _ensureContext();
    if (!_buffer) _buffer = await _loadBuffer(url);

    _gain = ctx.createGain();
    _gain.gain.value = volume;
    _gain.connect(ctx.destination);

    _source = ctx.createBufferSource();
    _source.buffer = _buffer;
    _source.loop = true;
    _source.connect(_gain);
    _source.start(0);
    _playing = true;
  } catch (e) {
    console.warn('BGM start failed:', e);
  }
}

export function stop() {
  if (_source) {
    try { _source.stop(); } catch {}
    _source.disconnect();
    _source = null;
  }
  if (_gain) {
    _gain.disconnect();
    _gain = null;
  }
  _playing = false;
}

export function isPlaying() { return _playing; }
