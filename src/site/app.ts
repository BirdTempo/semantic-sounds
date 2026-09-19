// The public page.
//
// It holds the whole set, the search engine and the renderer, bundled into
// one file by scripts/build-site.ts. Nothing is fetched, and nothing plays
// until a person clicks.
import { createSemanticSounds } from '../sdk';
import { RENDER_SAMPLE_RATE, tweak, isUntweaked, type Patch, type SoundEntry } from '../library/index';

const api = createSemanticSounds();

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const queryBox = el<HTMLInputElement>('q');
const grid = el<HTMLDivElement>('grid');
const countLine = el<HTMLParagraphElement>('count');
const filters = el<HTMLDivElement>('filters');
const volume = el<HTMLInputElement>('volume');
const mute = el<HTMLInputElement>('mute');
const live = el<HTMLDivElement>('live');

const pitch = el<HTMLInputElement>('pitch');
const pitchOut = el<HTMLOutputElement>('pitch-out');
const speed = el<HTMLInputElement>('speed');
const speedOut = el<HTMLOutputElement>('speed-out');
const loop = el<HTMLInputElement>('loop');
const gap = el<HTMLInputElement>('gap');
const gapOut = el<HTMLOutputElement>('gap-out');
const reset = el<HTMLButtonElement>('reset');

const WAVE_POINTS = 200;
const WAVE_WIDTH = 200;
const WAVE_HEIGHT = 44;
const GRID_LIMIT = 120;

let category = '';
let context: AudioContext | null = null;
let playing: HTMLElement | null = null;

// The loop runs on a timer, not on the buffer's own `loop` flag. A gap
// between repeats is the point: an interface sound is judged by how it
// feels when it fires again, not by how it sounds joined to itself.
let loopTimer: ReturnType<typeof setTimeout> | null = null;
let loopName = '';
let lastPlayed: SoundEntry | null = null;

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// ---------------------------------------------------------------- settings

/**
 * The volume and the mute switch persist. A person who lands here with
 * headphones on sets them once, and the page remembers.
 *
 * The pitch and speed controls deliberately do not persist. A person who
 * returns to a page where every sound is a fifth down has no way to guess
 * why, and would judge the set on a setting they forgot.
 *
 * Every read and write is guarded: a private window can throw on the first
 * touch of localStorage, and the page must still work.
 */
function remembered(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function remember(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // A page that cannot remember the volume still plays sounds.
  }
}

// ------------------------------------------------------------------ tweaks

/** The current controls, as the library's own transform request. */
function current(): { semitones: number; stretch: number } {
  // The slider says speed, because that is the word a person expects.
  // The library takes a time scale, which is its reciprocal: twice the
  // speed is half the length.
  return { semitones: Number(pitch.value), stretch: 1 / Number(speed.value) };
}

/** The patch as the controls make it. The same patch is heard and saved. */
function patchFor(entry: SoundEntry): Patch {
  return tweak(entry.patch, current());
}

function tweaked(): boolean {
  return !isUntweaked(current());
}

function showTweakLabels(): void {
  const steps = Number(pitch.value);
  pitchOut.textContent = steps === 0 ? '0' : `${steps > 0 ? '+' : ''}${steps}`;
  // Round first, then let Number drop the trailing zeros: the step is 0.05,
  // so a raw slider value can arrive as 1.1500000000000001.
  speedOut.textContent = `${Math.round(Number(speed.value) * 100) / 100}×`;
  gapOut.textContent = `${gap.value} ms`;
  reset.hidden = !tweaked();
  document.body.classList.toggle('is-tweaked', tweaked());
}

// ------------------------------------------------------------------- audio

function audioContext(): AudioContext {
  // Created on the first click, never on load. The autoplay rule requires
  // it, and surprise audio would be the wrong first impression anyway.
  context ??= new AudioContext();
  return context;
}

function stopLoop(): void {
  if (loopTimer !== null) clearTimeout(loopTimer);
  loopTimer = null;
  loopName = '';
  for (const tile of Array.from(document.querySelectorAll('.tile'))) tile.classList.remove('is-looping');
}

/** Render the current patch and play it once. */
function sound(entry: SoundEntry): number {
  const ctx = audioContext();
  const patch = patchFor(entry);
  const samples = api.render(patch);
  const buffer = ctx.createBuffer(1, samples.length, RENDER_SAMPLE_RATE);
  // renderPatch always returns a plain ArrayBuffer-backed Float32Array. The
  // DOM lib types copyToChannel against a narrower generic, so this cast
  // states a real invariant rather than hiding a gap.
  buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gainNode = ctx.createGain();
  gainNode.gain.value = Number(volume.value);
  source.connect(gainNode).connect(ctx.destination);
  source.start();
  return api.durationMs(patch);
}

function play(entry: SoundEntry, tile: HTMLElement): void {
  if (mute.checked) {
    say(`${entry.phrase} is muted`);
    return;
  }

  // A second click on the sound that is looping stops it. Without that,
  // the only way to stop is the loop switch, which is far from the tile.
  if (loopName === entry.name) {
    stopLoop();
    say(`stopped ${entry.phrase}`);
    return;
  }

  stopLoop();
  lastPlayed = entry;
  const durationMs = sound(entry);
  showPlayhead(tile, durationMs);

  if (loop.checked) {
    loopName = entry.name;
    tile.classList.add('is-looping');
    const again = (): void => {
      // Read the controls again on every repeat, so a slider moved during
      // a loop takes effect on the next pass instead of after a restart.
      if (mute.checked || loopName !== entry.name) return stopLoop();
      const ms = sound(entry);
      showPlayhead(tile, ms);
      loopTimer = setTimeout(again, ms + Number(gap.value));
    };
    loopTimer = setTimeout(again, durationMs + Number(gap.value));
    say(`looping ${entry.phrase}`);
  } else {
    say(`playing ${entry.phrase}`);
  }
}

/** Move a line across the waveform for exactly as long as the sound lasts. */
function showPlayhead(tile: HTMLElement, durationMs: number): void {
  if (playing && playing !== tile) playing.classList.remove('is-playing');
  tile.classList.add('is-playing');
  playing = tile;
  if (reducedMotion.matches) return;
  const head = tile.querySelector<HTMLElement>('.head');
  if (!head) return;
  head.style.animation = 'none';
  void head.offsetWidth; // Restart the animation on a repeated click.
  head.style.animation = `sweep ${durationMs}ms linear`;
}

/** One short message for a screen reader. The tiles are buttons, not text. */
function say(message: string): void {
  live.textContent = message;
}

// ---------------------------------------------------------------- waveform

/**
 * A peak envelope, not an average.
 *
 * Most of this set is transients: a tap, a click, a coin. An average over a
 * bucket flattens a 5ms spike into nothing, and every tile would look like
 * a flat line. The peak of each bucket keeps the shape a person recognises.
 */
function wavePath(samples: Float32Array): string {
  const bucket = Math.max(1, Math.floor(samples.length / WAVE_POINTS));
  const points = Math.min(WAVE_POINTS, Math.ceil(samples.length / bucket));
  const top: string[] = [];
  const bottom: string[] = [];
  const mid = WAVE_HEIGHT / 2;

  for (let i = 0; i < points; i++) {
    let high = 0;
    let low = 0;
    for (let j = i * bucket; j < Math.min((i + 1) * bucket, samples.length); j++) {
      const value = samples[j] ?? 0;
      if (value > high) high = value;
      if (value < low) low = value;
    }
    const x = (i / Math.max(1, points - 1)) * WAVE_WIDTH;
    top.push(`${x.toFixed(1)},${(mid - high * mid).toFixed(1)}`);
    bottom.push(`${x.toFixed(1)},${(mid - low * mid).toFixed(1)}`);
  }

  return `M${top.join(' L')} L${bottom.reverse().join(' L')} Z`;
}

/** Draw one tile: its waveform, and the length the controls give it. */
function paint(tile: HTMLElement): void {
  const entry = api.get(tile.dataset.name ?? '');
  const path = tile.querySelector('path');
  const meta = tile.querySelector('.meta');
  if (!entry || !path) return;
  const patch = patchFor(entry);
  path.setAttribute('d', wavePath(api.render(patch)));
  if (meta) {
    const layers = entry.patch.layers.length;
    meta.textContent = `${entry.category} · ${Math.round(api.durationMs(patch))} ms · ${layers} layer${layers === 1 ? '' : 's'}`;
  }
  tile.dataset.painted = 'yes';
}

/**
 * Draw one tile's waveform, once, when it scrolls into view.
 *
 * 1090 renders at load would freeze the page for seconds. A person sees
 * about twelve tiles at a time, so the page renders about twelve.
 */
const drawer = new IntersectionObserver(
  (records) => {
    for (const record of records) {
      if (!record.isIntersecting) continue;
      paint(record.target as HTMLElement);
    }
  },
  { rootMargin: '200px' }
);

/**
 * Redraw the tiles a person can see, after pitch or speed changed.
 *
 * This runs on `change`, not on `input`. A range fires `input` for every
 * pixel of a drag, and each redraw renders every visible patch, so a drag
 * would stutter. The number beside the slider still updates live.
 */
function repaintVisible(): void {
  for (const tile of Array.from(document.querySelectorAll<HTMLElement>('.tile'))) {
    if (tile.dataset.painted === 'yes') paint(tile);
  }
}

// ------------------------------------------------------------------- tiles

function action(label: string, title: string, run: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'act';
  button.textContent = label;
  button.title = title;
  button.addEventListener('click', (event) => {
    event.stopPropagation(); // The tile itself plays; these do not.
    run();
  });
  return button;
}

async function copyPatch(entry: SoundEntry, button: HTMLButtonElement): Promise<void> {
  const text = JSON.stringify(patchFor(entry), null, 2);
  try {
    await navigator.clipboard.writeText(text);
    flash(button, tweaked() ? 'copied (tweaked)' : 'copied');
  } catch {
    flash(button, 'press ctrl+c');
  }
}

/** Say what happened on the button itself, then put the label back. */
function flash(button: HTMLButtonElement, message: string): void {
  const original = button.dataset.label ?? button.textContent ?? '';
  button.dataset.label = original;
  button.textContent = message;
  say(message);
  setTimeout(() => {
    button.textContent = original;
  }, 1200);
}

/** The file name says what was changed, so two downloads never collide. */
function wavName(entry: SoundEntry): string {
  if (!tweaked()) return `${entry.name}.wav`;
  const parts = [entry.name];
  const steps = Number(pitch.value);
  if (steps !== 0) parts.push(`${steps > 0 ? 'up' : 'down'}${Math.abs(steps)}`);
  const rate = Number(speed.value);
  if (rate !== 1) parts.push(`${String(rate).replace('.', 'p')}x`);
  return `${parts.join('-')}.wav`;
}

function downloadWav(entry: SoundEntry): void {
  const blob = new Blob([api.wav(patchFor(entry)) as BlobPart], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = wavName(entry);
  link.click();
  // Revoke on the next frame: a synchronous revoke can beat the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function tile(entry: SoundEntry): HTMLElement {
  const card = document.createElement('article');
  card.className = 'tile';
  card.dataset.name = entry.name;

  const player = document.createElement('button');
  player.type = 'button';
  player.className = 'wave';
  // The phrase is beside it, so the drawing needs no name of its own.
  player.setAttribute('aria-label', `Play ${entry.phrase}`);
  player.innerHTML =
    `<svg viewBox="0 0 ${WAVE_WIDTH} ${WAVE_HEIGHT}" aria-hidden="true" preserveAspectRatio="none">` +
    '<path d="" /></svg><span class="head" aria-hidden="true"></span>';
  player.addEventListener('click', () => play(entry, card));

  const name = document.createElement('h3');
  name.textContent = entry.phrase;

  const meta = document.createElement('p');
  meta.className = 'meta';

  const acts = document.createElement('div');
  acts.className = 'acts';
  const copy = action('copy patch', `Copy the JSON patch for ${entry.phrase}`, () => void copyPatch(entry, copy));
  acts.append(copy, action('.wav', `Download ${entry.phrase} as a wav file`, () => downloadWav(entry)));

  card.append(player, name, meta, acts);
  drawer.observe(card);
  return card;
}

// ------------------------------------------------------------------ search

function matching(): SoundEntry[] {
  const query = queryBox.value.trim();
  const base = query.length === 0 ? [...api.sounds] : api.search(query, { limit: GRID_LIMIT }).map((m) => m.sound);
  return category === '' ? base : base.filter((entry) => entry.category === category);
}

function draw(): void {
  const found = matching();
  const shown = found.slice(0, GRID_LIMIT);

  stopLoop();
  grid.replaceChildren(...shown.map(tile));

  const query = queryBox.value.trim();
  if (found.length === 0) {
    countLine.textContent = `Nothing matched "${query}". Try fewer words, or a plainer noun.`;
  } else if (query.length === 0) {
    const scope = category === '' ? 'sounds' : `sounds in ${category}`;
    countLine.textContent =
      found.length > shown.length
        ? `${found.length} ${scope}. Showing the first ${shown.length}. Search to narrow it.`
        : `${found.length} ${scope}.`;
  } else {
    countLine.textContent = `${found.length} match${found.length === 1 ? '' : 'es'} for "${query}", best first.`;
  }
}

function buildFilters(): void {
  const names = ['', ...api.categories()];
  for (const name of names) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = name === '' ? 'all' : name;
    chip.setAttribute('aria-pressed', String(name === category));
    chip.addEventListener('click', () => {
      category = name;
      for (const other of Array.from(filters.querySelectorAll('.chip'))) {
        other.setAttribute('aria-pressed', String(other === chip));
      }
      draw();
    });
    filters.append(chip);
  }
}

// ------------------------------------------------------------------- start

volume.value = remembered('volume', '0.8');
mute.checked = remembered('mute', 'no') === 'yes';
gap.value = remembered('gap', '250');
volume.addEventListener('input', () => remember('volume', volume.value));
mute.addEventListener('change', () => {
  remember('mute', mute.checked ? 'yes' : 'no');
  if (mute.checked) stopLoop();
});

for (const control of [pitch, speed]) {
  control.addEventListener('input', showTweakLabels);
  control.addEventListener('change', repaintVisible);
}
gap.addEventListener('input', showTweakLabels);
gap.addEventListener('change', () => remember('gap', gap.value));
loop.addEventListener('change', () => {
  if (!loop.checked) stopLoop();
});

reset.addEventListener('click', () => {
  pitch.value = '0';
  speed.value = '1';
  showTweakLabels();
  repaintVisible();
  say('pitch and speed reset');
});

queryBox.addEventListener('input', draw);
queryBox.addEventListener('keydown', (event) => {
  // Enter plays the best answer, so a person never has to reach for a mouse.
  if (event.key !== 'Enter') return;
  event.preventDefault();
  const first = grid.querySelector<HTMLElement>('.tile');
  first?.querySelector<HTMLButtonElement>('.wave')?.click();
});

document.addEventListener('keydown', (event) => {
  // Space replays the last sound, so a person can change a slider and
  // hear the difference without moving the mouse back to the tile.
  const target = event.target as HTMLElement | null;
  const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';
  if (event.key !== ' ' || typing || lastPlayed === null) return;
  event.preventDefault();
  const tile = grid.querySelector<HTMLElement>(`.tile[data-name="${lastPlayed.name}"]`);
  if (tile) play(lastPlayed, tile);
});

showTweakLabels();
buildFilters();
draw();
