// Playback for both screens. It uses the library's own renderer, bundled by
// scripts/review/bundle.ts, so the browser plays exactly what the validator
// measured. The AudioContext is created on the first play, never on load.
import { renderPatch, RENDER_SAMPLE_RATE } from '/library-bundle.js';

let context = null;
let muted = false;
let volume = 0.8;

function audioContext() {
  if (!context) context = new AudioContext();
  return context;
}

export const player = {
  setMuted(flag) {
    muted = flag;
  },
  setVolume(value) {
    volume = value;
  },
  /** Render a patch and play it. Returns false when muted or when the patch is missing. */
  play(patch) {
    if (muted || !patch) return false;
    const ctx = audioContext();
    const samples = renderPatch(patch, RENDER_SAMPLE_RATE);
    const buffer = ctx.createBuffer(1, samples.length, RENDER_SAMPLE_RATE);
    buffer.copyToChannel(samples, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(ctx.destination);
    source.start();
    return true;
  },
};

/** Wire the mute checkbox and volume slider that both screens carry. */
export function wireControls() {
  const mute = document.getElementById('mute');
  const level = document.getElementById('volume');
  if (mute) {
    player.setMuted(mute.checked);
    mute.addEventListener('change', () => player.setMuted(mute.checked));
  }
  if (level) {
    player.setVolume(Number(level.value));
    level.addEventListener('input', () => player.setVolume(Number(level.value)));
  }
}

/** A play button for one patch. */
export function playButton(patch, label = 'Play') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'play';
  button.textContent = '▶ ' + label;
  button.disabled = !patch;
  button.addEventListener('click', () => player.play(patch));
  return button;
}
