// BGM player using HTML5 Audio with loop support.

let _audio = null;
let _playing = false;

export function start(url = '../trainer_tts/bgm_beat.wav', volume = 0.18) {
  stop();
  _audio = new Audio(url);
  _audio.loop = true;
  _audio.volume = volume;
  _audio.play().catch(() => {});
  _playing = true;
}

export function stop() {
  if (_audio) {
    _audio.pause();
    _audio.currentTime = 0;
    _audio = null;
  }
  _playing = false;
}

export function isPlaying() { return _playing; }
