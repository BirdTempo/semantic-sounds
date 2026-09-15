import { sounds, createSoundIndex, searchIndex, renderPatch, RENDER_SAMPLE_RATE } from '../src/library/index';
import type { SoundEntry } from '../src/library/index';

const index = createSoundIndex(sounds);

const queryInput = document.querySelector<HTMLInputElement>('#query')!;
const resultsList = document.querySelector<HTMLUListElement>('#results')!;
const muteCheckbox = document.querySelector<HTMLInputElement>('#mute')!;
const volumeSlider = document.querySelector<HTMLInputElement>('#volume')!;

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  // Created lazily, only after a user gesture (a click on a play button),
  // per the AudioContext autoplay rule.
  if (!audioContext) audioContext = new AudioContext();
  return audioContext;
}

function playEntry(entry: SoundEntry): void {
  if (muteCheckbox.checked) return;
  const context = getAudioContext();
  const samples = renderPatch(entry.patch, RENDER_SAMPLE_RATE);
  const buffer = context.createBuffer(1, samples.length, RENDER_SAMPLE_RATE);
  // renderPatch always returns a plain (non-shared) ArrayBuffer-backed
  // Float32Array; TS's DOM lib types copyToChannel against a narrower
  // Float32Array<ArrayBuffer> generic than Float32Array's own declared
  // type, so this cast reflects a real invariant, not a type-safety gap.
  buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);

  const source = context.createBufferSource();
  source.buffer = buffer;
  const gainNode = context.createGain();
  gainNode.gain.value = Number(volumeSlider.value);
  source.connect(gainNode).connect(context.destination);
  source.start();
}

function renderResults(entries: SoundEntry[]): void {
  resultsList.innerHTML = '';
  for (const entry of entries) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.className = 'play';
    button.textContent = '▶';
    button.addEventListener('click', () => playEntry(entry));
    const label = document.createElement('span');
    label.textContent = `${entry.phrase} (${entry.category})`;
    item.append(button, label);
    resultsList.append(item);
  }
}

queryInput.addEventListener('input', () => {
  const query = queryInput.value.trim();
  if (query.length === 0) {
    renderResults([]);
    return;
  }
  const matches = searchIndex(index, query, { limit: 10 });
  renderResults(matches.map((m) => m.sound));
});
