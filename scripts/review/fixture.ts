// A temp copy of the parts of the repository layout the store touches, so
// tests never write to the real library.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SoundEntry } from '../../src/library/types.js';

export function sampleEntry(overrides: Partial<SoundEntry> = {}): SoundEntry {
  return {
    name: 'tap',
    phrase: 'tap',
    category: 'ui-feedback',
    concept: 'A single sharp click for a light UI tap.',
    keywords: ['click', 'button', 'press', 'select'],
    patch: {
      layers: [
        {
          source: { type: 'oscillator', wave: 'sine', freqHz: 600 },
          envelope: { attackMs: 2, decayMs: 20, sustainLevel: 0, sustainMs: 0, releaseMs: 15 },
          gain: 0.6,
        },
      ],
    },
    ...overrides,
  };
}

export type Fixture = { root: string; cleanup(): void };

/** `batches` maps a file name (without .json) to its entries. */
export function makeFixture(batches: Record<string, SoundEntry[]>, trailingNewline = true): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'sound-review-'));
  const soundsDir = join(root, 'src', 'library', 'sounds');
  mkdirSync(soundsDir, { recursive: true });
  for (const [name, entries] of Object.entries(batches)) {
    writeFileSync(join(soundsDir, `${name}.json`), JSON.stringify(entries, null, 2) + (trailingNewline ? '\n' : ''));
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
