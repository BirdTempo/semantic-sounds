// @vitest-environment happy-dom
//
// This test drives the real page script against the real generated markup.
// It reads site/index.html, drops the bundled script, and imports the
// TypeScript source in its place. So an id the page renames and the script
// still looks for fails here, which is the bug this pairing is most likely
// to have.
import { describe, it, expect, beforeAll, vi } from 'vitest';
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
