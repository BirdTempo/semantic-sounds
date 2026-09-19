// @vitest-environment happy-dom
//
// This test drives the real page script against the real generated markup.
// It reads site/index.html, drops the bundled script, and imports the
// TypeScript source in its place. So an id the page renames and the script
// still looks for fails here, which is the bug this pairing is most likely
// to have.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite } from '../../scripts/build-site';
import { sounds } from '../library/index';

const siteDir = join(dirname(fileURLToPath(import.meta.url)), '../../site');

type StartedSource = { start: ReturnType<typeof vi.fn> };
const started: StartedSource[] = [];
const copied: string[] = [];
const downloaded: string[] = [];
let observed: Element[] = [];

/** Everything the page needs that happy-dom does not provide. */
function installStubs(): void {
  // Draw every waveform at once, so the test can assert on the shape.
  class Observer {
    constructor(private readonly callback: (records: { isIntersecting: boolean; target: Element }[]) => void) {}
    observe(target: Element): void {
      observed.push(target);
      this.callback([{ isIntersecting: true, target }]);
    }
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('IntersectionObserver', Observer);

  vi.stubGlobal(
    'AudioContext',
    class {
      createBuffer(channels: number, length: number, rate: number) {
        return { length, rate, channels, copyToChannel: vi.fn() };
      }
      createBufferSource() {
        const source = { buffer: null, connect: vi.fn(() => ({ connect: vi.fn() })), start: vi.fn() };
        started.push(source as unknown as StartedSource);
        return source;
      }
      createGain() {
        return { gain: { value: 1 }, connect: vi.fn(() => ({ connect: vi.fn() })) };
      }
      get destination() {
        return {};
      }
    }
  );

  Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(async (text: string) => void copied.push(text)) },
  });

  globalThis.URL.createObjectURL = vi.fn(() => 'blob:test');
  globalThis.URL.revokeObjectURL = vi.fn();
  // happy-dom's anchor click does not fire, so record the download name.
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    if (this.download) downloaded.push(this.download);
    else click?.call(this);
  };
}

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const tiles = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('.tile'));

beforeAll(async () => {
  await buildSite();
  const html = readFileSync(join(siteDir, 'index.html'), 'utf8');
  const body = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'));
  // Drop the bundled script. The TypeScript source takes its place.
  document.body.innerHTML = body.replace(/<script type="module">[\s\S]*?<\/script>/, '');
  installStubs();
  await import('./app');
}, 60_000);

describe('the page script against the real markup', () => {
  it('finds every element the page gives it', () => {
    for (const id of ['q', 'grid', 'count', 'filters', 'volume', 'mute', 'live']) {
      expect(el(id), `the page has no #${id}`).not.toBeNull();
    }
  });

  it('fills the grid on load', () => {
    expect(tiles().length).toBeGreaterThan(0);
    expect(el('count').textContent).toContain(`${sounds.length} sounds`);
  });

  it('plays nothing on load', () => {
    expect(started.length).toBe(0);
  });

  it('draws a real waveform, not a flat line', () => {
    const path = tiles()[0]?.querySelector('path')?.getAttribute('d') ?? '';
    expect(path.startsWith('M')).toBe(true);
    expect(path.endsWith('Z')).toBe(true);
    // A peak envelope over a real sound leaves many distinct heights. An
    // average would flatten a transient and give one repeated value.
    const heights = new Set(path.match(/,([\d.]+)/g));
    expect(heights.size).toBeGreaterThan(8);
  });

  it('offers one filter for every category and an "all"', () => {
    const chips = Array.from(document.querySelectorAll('.chip'));
    expect(chips.length).toBe(new Set(sounds.map((s) => s.category)).size + 1);
    expect(chips[0]?.textContent).toBe('all');
    expect(chips[0]?.getAttribute('aria-pressed')).toBe('true');
  });

  it('narrows the grid to one category', () => {
    const chip = Array.from(document.querySelectorAll<HTMLElement>('.chip')).find((c) => c.textContent === 'animals');
    chip?.click();
    expect(tiles().length).toBeGreaterThan(0);
    for (const tile of tiles()) {
      expect(sounds.find((s) => s.name === tile.dataset.name)?.category).toBe('animals');
    }
    Array.from(document.querySelectorAll<HTMLElement>('.chip'))[0]?.click(); // back to all
  });

  it('answers plain prose, best first', () => {
    const box = el<HTMLInputElement>('q');
    box.value = 'the file finished uploading';
    box.dispatchEvent(new Event('input'));
    expect(tiles()[0]?.dataset.name).toBe('upload-complete');
    expect(el('count').textContent).toContain('best first');
  });

  it('says so plainly when nothing matches', () => {
    const box = el<HTMLInputElement>('q');
    box.value = 'zzzzqqqx';
    box.dispatchEvent(new Event('input'));
    expect(tiles().length).toBe(0);
    expect(el('count').textContent).toContain('Nothing matched');
  });

  it('plays a sound on a click, and only then', () => {
    const box = el<HTMLInputElement>('q');
    box.value = 'a dog barking';
    box.dispatchEvent(new Event('input'));
    expect(started.length).toBe(0);

    tiles()[0]?.querySelector<HTMLElement>('.wave')?.click();
    expect(started.length).toBe(1);
    expect(started[0]?.start).toHaveBeenCalled();
    expect(el('live').textContent).toContain('playing');
  });

  it('plays nothing while muted', () => {
    const before = started.length;
    el<HTMLInputElement>('mute').checked = true;
    tiles()[0]?.querySelector<HTMLElement>('.wave')?.click();
    expect(started.length).toBe(before);
    expect(el('live').textContent).toContain('muted');
    el<HTMLInputElement>('mute').checked = false;
  });

  it('copies the patch as JSON', async () => {
    const tile = tiles()[0]!;
    const button = Array.from(tile.querySelectorAll<HTMLElement>('.act')).find((b) => b.textContent === 'copy patch');
    button?.click();
    await vi.waitFor(() => expect(copied.length).toBe(1));
    const patch = JSON.parse(copied[0]!) as { layers: unknown[] };
    expect(patch.layers.length).toBeGreaterThan(0);
    expect(patch).toEqual(sounds.find((s) => s.name === tile.dataset.name)?.patch);
  });

  it('downloads a wav named after the sound', () => {
    const tile = tiles()[0]!;
    const button = Array.from(tile.querySelectorAll<HTMLElement>('.act')).find((b) => b.textContent === '.wav');
    button?.click();
    expect(downloaded).toContain(`${tile.dataset.name}.wav`);
  });

  it('plays the best answer when Enter is pressed', () => {
    const before = started.length;
    const box = el<HTMLInputElement>('q');
    box.value = 'a cat purring';
    box.dispatchEvent(new Event('input'));
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(started.length).toBe(before + 1);
  });

  it('remembers the volume', () => {
    const slider = el<HTMLInputElement>('volume');
    slider.value = '0.35';
    slider.dispatchEvent(new Event('input'));
    expect(window.localStorage.getItem('volume')).toBe('0.35');
  });

  it('observes every tile it draws, so none is left blank', () => {
    expect(observed.length).toBeGreaterThanOrEqual(tiles().length);
    observed = [];
  });
});

describe('the pitch, speed and loop controls', () => {
  const setRange = (id: string, value: string): void => {
    const input = el<HTMLInputElement>(id);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('change'));
  };

  const firstTile = (): HTMLElement => {
    const box = el<HTMLInputElement>('q');
    box.value = 'a coin';
    box.dispatchEvent(new Event('input'));
    return tiles()[0]!;
  };

  // Every case starts from the default controls. Without this, one failed
  // assertion leaves a slider moved and every later case tests the wrong
  // thing -- which is exactly what happened when these were first written.
  beforeEach(() => {
    setRange('pitch', '0');
    setRange('speed', '1');
    el<HTMLInputElement>('gap').value = '250';
    el<HTMLInputElement>('loop').checked = false;
    el<HTMLInputElement>('loop').dispatchEvent(new Event('change'));
    copied.length = 0;
    downloaded.length = 0;
  });

  it('hides the reset button until something changes', () => {
    setRange('pitch', '0');
    expect(el('reset').hidden).toBe(true);
    setRange('pitch', '5');
    expect(el('reset').hidden).toBe(false);
    setRange('pitch', '0');
    expect(el('reset').hidden).toBe(true);
  });

  it('labels the pitch with a sign and the speed with a multiplier', () => {
    setRange('pitch', '7');
    expect(el('pitch-out').textContent).toBe('+7');
    setRange('pitch', '-7');
    expect(el('pitch-out').textContent).toBe('-7');
    setRange('speed', '2');
    expect(el('speed-out').textContent).toBe('2×');
    setRange('pitch', '0');
    setRange('speed', '1');
  });

  it('changes the duration a tile reports when the speed changes', () => {
    const tile = firstTile();
    const plain = tile.querySelector('.meta')!.textContent!;
    setRange('speed', '0.5');
    const slow = tiles()[0]!.querySelector('.meta')!.textContent!;
    expect(slow).not.toBe(plain);
    const ms = (text: string): number => Number(/(\d+) ms/.exec(text)![1]);
    // Half speed is twice the length. One millisecond of rounding is fine.
    expect(Math.abs(ms(slow) - ms(plain) * 2)).toBeLessThanOrEqual(1);
    setRange('speed', '1');
  });

  it('redraws the waveform when the speed changes', () => {
    const before = firstTile().querySelector('path')!.getAttribute('d');
    setRange('speed', '0.5');
    expect(tiles()[0]!.querySelector('path')!.getAttribute('d')).not.toBe(before);
    setRange('speed', '1');
    expect(tiles()[0]!.querySelector('path')!.getAttribute('d')).toBe(before);
  });

  it('copies the tweaked patch, so the JSON is the sound that played', async () => {
    const tile = firstTile();
    const original = sounds.find((s) => s.name === tile.dataset.name)!.patch;
    copied.length = 0;
    setRange('pitch', '12');

    const copy = Array.from(tiles()[0]!.querySelectorAll<HTMLElement>('.act')).find(
      (b) => b.textContent === 'copy patch'
    );
    copy?.click();
    await vi.waitFor(() => expect(copied.length).toBe(1));

    const patch = JSON.parse(copied[0]!) as typeof original;
    expect(patch).not.toEqual(original);
    const source = patch.layers[0]!.source;
    const before = original.layers[0]!.source;
    if (source.type === 'oscillator' && before.type === 'oscillator') {
      // Twelve semitones double the frequency.
      expect(source.freqHz).toBeCloseTo(before.freqHz * 2, 4);
    }
    setRange('pitch', '0');
  });

  it('names a tweaked download so two files never collide', () => {
    const tile = firstTile();
    const name = tile.dataset.name!;
    downloaded.length = 0;

    const wav = (): void => {
      const button = Array.from(tiles()[0]!.querySelectorAll<HTMLElement>('.act')).find((b) => b.textContent === '.wav');
      button?.click();
    };

    wav();
    expect(downloaded).toContain(`${name}.wav`);

    setRange('pitch', '-5');
    wav();
    expect(downloaded).toContain(`${name}-down5.wav`);

    setRange('speed', '2');
    wav();
    expect(downloaded).toContain(`${name}-down5-2x.wav`);

    setRange('pitch', '0');
    setRange('speed', '1');
  });

  it('resets pitch and speed together', () => {
    setRange('pitch', '9');
    setRange('speed', '3');
    el<HTMLButtonElement>('reset').click();
    expect(el<HTMLInputElement>('pitch').value).toBe('0');
    expect(el<HTMLInputElement>('speed').value).toBe('1');
    expect(el('reset').hidden).toBe(true);
  });

  it('repeats while looping, and stops on a second click', async () => {
    const tile = firstTile();
    el<HTMLInputElement>('gap').value = '0';
    el<HTMLInputElement>('loop').checked = true;
    el<HTMLInputElement>('loop').dispatchEvent(new Event('change'));

    const before = started.length;
    tile.querySelector<HTMLElement>('.wave')!.click();
    expect(started.length).toBe(before + 1);
    expect(tiles()[0]!.classList.contains('is-looping')).toBe(true);
    expect(el('live').textContent).toContain('looping');

    // The repeat is on a timer set to the sound's own length.
    await vi.waitFor(() => expect(started.length).toBeGreaterThan(before + 1), { timeout: 2000 });

    tiles()[0]!.querySelector<HTMLElement>('.wave')!.click();
    expect(tiles()[0]!.classList.contains('is-looping')).toBe(false);
    expect(el('live').textContent).toContain('stopped');

    const settled = started.length;
    await new Promise((r) => setTimeout(r, 400));
    expect(started.length).toBe(settled);
  });

  it('stops the loop when the loop switch goes off', async () => {
    const tile = firstTile();
    el<HTMLInputElement>('loop').checked = true;
    el<HTMLInputElement>('loop').dispatchEvent(new Event('change'));
    tile.querySelector<HTMLElement>('.wave')!.click();
    expect(tiles()[0]!.classList.contains('is-looping')).toBe(true);

    el<HTMLInputElement>('loop').checked = false;
    el<HTMLInputElement>('loop').dispatchEvent(new Event('change'));
    expect(tiles()[0]!.classList.contains('is-looping')).toBe(false);

    const settled = started.length;
    await new Promise((r) => setTimeout(r, 400));
    expect(started.length).toBe(settled);
  });

  it('replays the last sound when Space is pressed', () => {
    const tile = firstTile();
    tile.querySelector<HTMLElement>('.wave')!.click();
    const before = started.length;
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    expect(started.length).toBe(before + 1);
  });

  it('does not replay when Space is typed into the search box', () => {
    const before = started.length;
    el<HTMLInputElement>('q').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    expect(started.length).toBe(before);
  });
});
