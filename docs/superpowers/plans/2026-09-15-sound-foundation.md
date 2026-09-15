# Sound Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the entry shape, deterministic renderer, contract validator, 40-sound seed set, prose search engine, retrieval probe, and a minimal web player for Semantic Sounds.

**Architecture:** One TypeScript renderer turns a small JSON "patch" (oscillator/noise layers with envelopes and optional filters) into a `Float32Array`, sample by sample, deterministically. A validator renders every patch and checks it against a fixed contract (duration, peak, loudness, DC offset, fades) plus a concept-agreement check against computed descriptors. A lexical query engine (stemmer, stopwords, scored keywords, adapted from `semantic-icons`) finds entries from prose. A minimal Vite page plays results through the Web Audio API.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Vitest, tsup (library build), Vite (web player dev build), Node >=18, no runtime dependencies in the library itself.

**Spec:** `docs/superpowers/specs/2026-09-15-sound-contract-and-renderer-design.md`

## Global Constraints

- Renderer output must be byte-identical across repeated calls with the same patch and sample rate (determinism).
- Renderer must render a worst-case 1s/4-layer patch in well under 5ms median (confirmed feasible in brainstorming: ~2.5ms with a wavetable sine, recurrence envelope, and xorshift noise — do not implement a naive per-sample `Math.sin`/`Math.exp`/`Math.random` version).
- Fixed internal sample rate: `RENDER_SAMPLE_RATE = 48000`.
- Patch duration is never a separate field: it is derived as the longest of the patch's layers' own envelope durations (`attackMs + decayMs + sustainMs + releaseMs`).
- Contract thresholds (validator-enforced): duration 30-1500ms, layers 1-4, peak <= -1dBFS (0.891 linear), loudness RMS within -20 to -14 dBFS, `|DC offset| <= 0.001`, a forced 2-3ms fade at both ends, kebab-case `name`/`category`, concept >= 20 characters, >= 4 keywords, no duplicate `name` or `phrase` in the library.
- License: MIT. `package.json` `author` field: `"BirdTempo"` (not "Andrew Carmer").
- Package name: `semantic-sounds`.
- No sound plays without a user gesture (browser autoplay rule); the web player always shows a mute/volume control.
- Every problem a validator finds is reported; the validator never stops at the first problem.

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `LICENSE`
- Create: `vitest.config.ts`

**Interfaces:**
- Produces: an `npm test` script running Vitest, an `npm run typecheck` script running `tsc --noEmit`, an `npm run build` script running `tsup`, a `src/` directory tsconfig picks up.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "semantic-sounds",
  "version": "0.1.0",
  "description": "A curated set of short UI sounds, found by plain prose.",
  "type": "module",
  "license": "MIT",
  "author": "BirdTempo",
  "engines": { "node": ">=18" },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./package.json": "./package.json"
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup src/library/index.ts --format esm --dts --clean --out-dir dist",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "sounds:build": "node scripts/build-library.mjs",
    "sounds:check": "node scripts/check-library.mjs",
    "probe": "node --import tsx scripts/prose-probe.ts",
    "tune": "node --import tsx scripts/tune-thresholds.ts"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "tsx": "^4.16.0",
    "vite": "^5.4.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "declaration": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "types": ["node"],
    "include": ["src", "scripts"]
  }
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Write `.gitignore`**

```
node_modules/
dist/
web/dist/
*.log
.DS_Store
```

- [ ] **Step 5: Write `LICENSE`**

Standard MIT license text, copyright holder `BirdTempo`, year 2026.

```
MIT License

Copyright (c) 2026 BirdTempo

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 6: Install dependencies**

Run: `npm install`

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore LICENSE package-lock.json
git commit -m "Scaffold project: package.json, tsconfig, vitest, MIT license"
```

---

## Task 2: Entry shape and constants (`src/library/types.ts`)

**Files:**
- Create: `src/library/types.ts`
- Test: `src/library/types.test.ts`

**Interfaces:**
- Produces: `SoundEntry`, `Patch`, `Layer`, `OscillatorSource`, `NoiseSource`, `Envelope`, `Filter`, `SoundMatch` types; `RENDER_SAMPLE_RATE`, `MIN_LAYERS`, `MAX_LAYERS`, `MIN_FREQ_HZ`, `MAX_FREQ_HZ` constants. Every later task imports from this file.

- [ ] **Step 1: Write the test**

```ts
// src/library/types.test.ts
import { describe, it, expect } from 'vitest';
import type { SoundEntry } from './types';
import { RENDER_SAMPLE_RATE, MAX_LAYERS } from './types';

describe('types', () => {
  it('accepts a well-formed SoundEntry', () => {
    const entry: SoundEntry = {
      name: 'tap',
      phrase: 'tap',
      category: 'ui-feedback',
      concept: 'A single soft click for a light UI tap.',
      keywords: ['click', 'button', 'press', 'select'],
      patch: {
        layers: [
          {
            source: { type: 'oscillator', wave: 'sine', freqHz: 600 },
            envelope: { attackMs: 2, decayMs: 20, sustainLevel: 0, sustainMs: 0, releaseMs: 10 },
            gain: 0.8,
          },
        ],
      },
    };
    expect(entry.patch.layers).toHaveLength(1);
  });

  it('exposes the render sample rate and layer cap', () => {
    expect(RENDER_SAMPLE_RATE).toBe(48000);
    expect(MAX_LAYERS).toBe(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- types.test.ts`
Expected: FAIL, `Cannot find module './types'`

- [ ] **Step 3: Write the implementation**

```ts
// src/library/types.ts
export const RENDER_SAMPLE_RATE = 48000;
export const MIN_LAYERS = 1;
export const MAX_LAYERS = 4;
export const MIN_FREQ_HZ = 40;
export const MAX_FREQ_HZ = 8000;
export const MIN_DURATION_MS = 30;
export const MAX_DURATION_MS = 1500;
export const MIN_KEYWORDS = 4;

export type Wave = 'sine' | 'triangle' | 'square' | 'saw';
export type NoiseColor = 'white' | 'pink';
export type FilterType = 'lowpass' | 'highpass' | 'bandpass';

export type OscillatorSource = {
  type: 'oscillator';
  wave: Wave;
  freqHz: number;
  pitchEnvelope?: { toHz: number; timeMs: number };
};

export type NoiseSource = {
  type: 'noise';
  color: NoiseColor;
};

export type Envelope = {
  attackMs: number;
  decayMs: number;
  sustainLevel: number;
  sustainMs: number;
  releaseMs: number;
};

export type Filter = {
  type: FilterType;
  cutoffHz: number;
  q?: number;
};

export type Layer = {
  source: OscillatorSource | NoiseSource;
  envelope: Envelope;
  filter?: Filter;
  gain: number;
};

export type Patch = {
  layers: Layer[];
};

export type SoundEntry = {
  name: string;
  phrase: string;
  category: string;
  concept: string;
  keywords: string[];
  patch: Patch;
};

export type SoundMatch = {
  sound: SoundEntry;
  score: number;
  matched: string[];
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/library/types.ts src/library/types.test.ts
git commit -m "Add SoundEntry/Patch type definitions and shared constants"
```

---

## Task 3: Word normalization and stemming (`src/library/normalize.ts`)

**Files:**
- Create: `src/library/normalize.ts`
- Test: `src/library/normalize.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces: `stem(word: string): string`, `terms(text: string): string[]`, `aliasKey(text: string): string`, `rawKey(text: string): string`. Task 5 (query.ts) and Task 7 (validate.ts) both import these.

- [ ] **Step 1: Write the test**

```ts
// src/library/normalize.test.ts
import { describe, it, expect } from 'vitest';
import { stem, terms, aliasKey, rawKey } from './normalize';

describe('stem', () => {
  it('strips regular suffixes', () => {
    expect(stem('running')).toBe('run');
    expect(stem('seeing')).toBe('see');
    expect(stem('played')).toBe('play');
    expect(stem('grabbed')).toBe('grab');
    expect(stem('bells')).toBe('bell');
    expect(stem('categories')).toBe('category');
    expect(stem('glasses')).toBe('glass');
    expect(stem('heroes')).toBe('hero');
  });

  it('handles irregular words', () => {
    expect(stem('children')).toBe('child');
    expect(stem('agreed')).toBe('agree');
  });

  it('does not mangle short or already-simple words', () => {
    expect(stem('bus')).toBe('bus');
    expect(stem('lens')).toBe('lens');
    expect(stem('tap')).toBe('tap');
  });
});

describe('terms', () => {
  it('drops stopwords but keeps direction/state words', () => {
    const result = terms('the sound of a toggle turning on');
    expect(result).not.toContain('the');
    expect(result).not.toContain('of');
    expect(result).not.toContain('a');
    expect(result).toContain('on');
  });

  it('folds accents and lowercases', () => {
    expect(terms('Café')).toContain('cafe');
  });
});

describe('aliasKey and rawKey', () => {
  it('aliasKey stems, rawKey does not', () => {
    expect(aliasKey('Success Chimes')).toBe('success chime');
    expect(rawKey('Success Chimes')).toBe('success chimes');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- normalize.test.ts`
Expected: FAIL, `Cannot find module './normalize'`

- [ ] **Step 3: Write the implementation**

```ts
// src/library/normalize.ts
const IRREGULAR: Record<string, string> = {
  children: 'child',
  mice: 'mouse',
  feet: 'foot',
  teeth: 'tooth',
  geese: 'goose',
  men: 'man',
  women: 'woman',
  people: 'person',
  agreed: 'agree',
  freed: 'free',
};

// Generic function/grammar words only. Direction, state, and register words
// (up, down, on, off, open, close, start, stop, low, high, short, long,
// fast, slow, no, not) are deliberately kept: they carry meaning for a
// sound library the way "up"/"down" carry meaning for an icon library.
const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'to', 'for', 'and', 'or', 'is', 'are', 'was',
  'were', 'be', 'been', 'being', 'it', 'its', 'this', 'that', 'these',
  'those', 'with', 'as', 'at', 'by', 'from', 'into', 'than', 'then',
  'so', 'such', 'very', 'i', 'you', 'he', 'she', 'we', 'they', 'my',
  'your', 'his', 'her', 'our', 'their', 'me', 'him', 'them', 'us',
  'someone', 'something', 'there', 'here', 'what', 'when', 'how',
  'just', 'has', 'have', 'had', 'does', 'did', 'about', 'if',
]);

function isVowel(ch: string): boolean {
  return 'aeiou'.includes(ch);
}

function hasVowel(text: string): boolean {
  for (const ch of text) {
    if (isVowel(ch)) return true;
  }
  return false;
}

function undouble(text: string): string {
  if (text.length < 2) return text;
  const last = text[text.length - 1];
  const secondLast = text[text.length - 2];
  if (last === secondLast && !isVowel(last) && last !== 'l' && last !== 's' && last !== 'f') {
    return text.slice(0, -1);
  }
  return text;
}

export function stem(word: string): string {
  const irregular = IRREGULAR[word];
  if (irregular) return irregular;
  if (word.length <= 3) return word;

  if (word.endsWith('ies') && word.length > 4) {
    return word.slice(0, -3) + 'y';
  }

  if (
    (word.endsWith('sses') || word.endsWith('shes') || word.endsWith('ches') || word.endsWith('xes')) &&
    word.length > 4
  ) {
    return word.slice(0, -2);
  }

  if (word.endsWith('oes') && word.length > 4) {
    return word.slice(0, -2);
  }

  if (word.endsWith('ing') && word.length > 5) {
    const stripped = word.slice(0, -3);
    if (hasVowel(stripped)) return undouble(stripped);
  }

  if (word.endsWith('ed') && word.length > 4) {
    const stripped = word.slice(0, -2);
    if (hasVowel(stripped)) return undouble(stripped);
  }

  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) {
    const lastTwo = word.slice(-2);
    if (lastTwo !== 'us' && lastTwo !== 'is' && lastTwo !== 'ns') {
      return word.slice(0, -1);
    }
  }

  return word;
}

function foldAccents(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function words(text: string): string[] {
  const cleaned = foldAccents(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  return cleaned.split(' ').filter((word) => word.length > 0);
}

export function terms(text: string): string[] {
  return words(text)
    .filter((word) => !STOPWORDS.has(word))
    .map(stem);
}

export function aliasKey(text: string): string {
  return terms(text).join(' ');
}

export function rawKey(text: string): string {
  return words(text)
    .filter((word) => !STOPWORDS.has(word))
    .join(' ');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- normalize.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/library/normalize.ts src/library/normalize.test.ts
git commit -m "Add stemmer, stopwords, and term normalization"
```

---

## Task 4: Phrase normalization (`src/library/normalize-phrase.ts`)

**Files:**
- Create: `src/library/normalize-phrase.ts`
- Test: `src/library/normalize-phrase.test.ts`

**Interfaces:**
- Produces: `normalizePhrase(text: string): string`. Task 7 (validate.ts) uses it for duplicate-phrase detection; a future SDK/MCP task uses it for lookups.

- [ ] **Step 1: Write the test**

```ts
// src/library/normalize-phrase.test.ts
import { describe, it, expect } from 'vitest';
import { normalizePhrase } from './normalize-phrase';

describe('normalizePhrase', () => {
  it('trims, lowercases, and collapses whitespace', () => {
    expect(normalizePhrase('  Success   Chime ')).toBe('success chime');
  });

  it('is idempotent', () => {
    const once = normalizePhrase('Tap');
    expect(normalizePhrase(once)).toBe(once);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- normalize-phrase.test.ts`
Expected: FAIL, `Cannot find module './normalize-phrase'`

- [ ] **Step 3: Write the implementation**

```ts
// src/library/normalize-phrase.ts
export function normalizePhrase(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- normalize-phrase.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/library/normalize-phrase.ts src/library/normalize-phrase.test.ts
git commit -m "Add phrase normalization for duplicate detection"
```

---

## Task 5: Renderer (`src/library/render.ts`)

**Files:**
- Create: `src/library/render.ts`
- Test: `src/library/render.test.ts`

**Interfaces:**
- Consumes: `Patch`, `Layer`, `Envelope`, `Filter`, `RENDER_SAMPLE_RATE` from `./types`.
- Produces: `renderPatch(patch: Patch, sampleRate?: number): Float32Array`. Task 7 (validate.ts), the web player, and every future SDK task call this and only this function to get audio.

- [ ] **Step 1: Write the tests**

```ts
// src/library/render.test.ts
import { describe, it, expect } from 'vitest';
import { renderPatch } from './render';
import type { Patch } from './types';
import { RENDER_SAMPLE_RATE } from './types';

function simplePatch(overrides: Partial<Patch['layers'][0]> = {}): Patch {
  return {
    layers: [
      {
        source: { type: 'oscillator', wave: 'sine', freqHz: 440 },
        envelope: { attackMs: 5, decayMs: 20, sustainLevel: 0.3, sustainMs: 20, releaseMs: 30 },
        gain: 0.8,
        ...overrides,
      },
    ],
  };
}

describe('renderPatch', () => {
  it('is deterministic for the same patch', () => {
    const patch = simplePatch();
    const a = renderPatch(patch);
    const b = renderPatch(patch);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toBe(b[i]);
    }
  });

  it('derives duration from the longest layer envelope', () => {
    const patch = simplePatch(); // 5+20+20+30 = 75ms
    const samples = renderPatch(patch);
    const expectedSamples = Math.round((75 / 1000) * RENDER_SAMPLE_RATE);
    expect(samples.length).toBe(expectedSamples);
  });

  it('fades in and out so start and end are near zero', () => {
    const samples = renderPatch(simplePatch());
    expect(Math.abs(samples[0])).toBeLessThan(0.01);
    expect(Math.abs(samples[samples.length - 1])).toBeLessThan(0.01);
  });

  it('never exceeds the peak ceiling even with 4 loud layers', () => {
    const patch: Patch = {
      layers: Array.from({ length: 4 }, (_, i) => ({
        source: { type: 'oscillator', wave: 'sine' as const, freqHz: 300 + i * 50 },
        envelope: { attackMs: 2, decayMs: 10, sustainLevel: 1, sustainMs: 50, releaseMs: 10 },
        gain: 1,
      })),
    };
    const samples = renderPatch(patch);
    let peak = 0;
    for (const s of samples) peak = Math.max(peak, Math.abs(s));
    expect(peak).toBeLessThanOrEqual(0.891 + 1e-6);
  });

  it('renders noise layers without throwing', () => {
    const patch: Patch = {
      layers: [
        {
          source: { type: 'noise', color: 'white' },
          envelope: { attackMs: 1, decayMs: 10, sustainLevel: 0, sustainMs: 0, releaseMs: 20 },
          gain: 0.5,
        },
      ],
    };
    expect(() => renderPatch(patch)).not.toThrow();
  });

  it('renders a worst-case 1s/4-layer patch in well under 5ms median', () => {
    const patch: Patch = {
      layers: Array.from({ length: 4 }, (_, i) => ({
        source: { type: 'oscillator' as const, wave: 'sine' as const, freqHz: 220 + i * 110 },
        envelope: { attackMs: 5, decayMs: 100, sustainLevel: 0.4, sustainMs: 700, releaseMs: 195 },
        filter: { type: 'lowpass' as const, cutoffHz: 4000 },
        gain: 0.5,
      })),
    };
    // warm up
    for (let i = 0; i < 3; i++) renderPatch(patch);
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      renderPatch(patch);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)];
    expect(median).toBeLessThan(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- render.test.ts`
Expected: FAIL, `Cannot find module './render'`

- [ ] **Step 3: Write the implementation**

```ts
// src/library/render.ts
import type { Envelope, Filter, Layer, Patch, Wave } from './types';
import { RENDER_SAMPLE_RATE } from './types';

const SINE_TABLE_SIZE = 2048;
const sineTable = new Float32Array(SINE_TABLE_SIZE);
for (let i = 0; i < SINE_TABLE_SIZE; i++) {
  sineTable[i] = Math.sin((2 * Math.PI * i) / SINE_TABLE_SIZE);
}

function tableSine(phase01: number): number {
  const pos = phase01 * SINE_TABLE_SIZE;
  const i0 = pos | 0;
  const frac = pos - i0;
  const i1 = (i0 + 1) & (SINE_TABLE_SIZE - 1);
  const v0 = sineTable[i0] ?? 0;
  const v1 = sineTable[i1] ?? 0;
  return v0 + (v1 - v0) * frac;
}

function waveAt(wave: Wave, phase01: number): number {
  switch (wave) {
    case 'sine':
      return tableSine(phase01);
    case 'triangle':
      return 4 * Math.abs(phase01 - 0.5) - 1;
    case 'square':
      return phase01 < 0.5 ? 1 : -1;
    case 'saw':
      return 2 * phase01 - 1;
    default:
      return tableSine(phase01);
  }
}

function createRng(seed: number) {
  let state = seed || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state |= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state |= 0;
    return (state >>> 0) / 0xffffffff;
  };
}

function envelopeDurationMs(env: Envelope): number {
  return env.attackMs + env.decayMs + env.sustainMs + env.releaseMs;
}

function renderEnvelope(env: Envelope, sampleCount: number, sampleRate: number): Float32Array {
  const out = new Float32Array(sampleCount);
  const attackSamples = Math.max(1, Math.round((env.attackMs / 1000) * sampleRate));
  const decaySamples = Math.max(1, Math.round((env.decayMs / 1000) * sampleRate));
  const sustainSamples = Math.max(0, Math.round((env.sustainMs / 1000) * sampleRate));
  const releaseSamples = Math.max(1, Math.round((env.releaseMs / 1000) * sampleRate));
  const decayStart = attackSamples;
  const sustainStart = decayStart + decaySamples;
  const releaseStart = sustainStart + sustainSamples;

  for (let i = 0; i < sampleCount; i++) {
    if (i < attackSamples) {
      out[i] = i / attackSamples;
    } else if (i < sustainStart) {
      const t = (i - decayStart) / decaySamples;
      out[i] = 1 - t * (1 - env.sustainLevel);
    } else if (i < releaseStart) {
      out[i] = env.sustainLevel;
    } else {
      const t = (i - releaseStart) / releaseSamples;
      out[i] = env.sustainLevel * Math.max(0, 1 - t);
    }
  }
  return out;
}

function onePoleLowpass(input: Float32Array, cutoffHz: number, sampleRate: number): Float32Array {
  const out = new Float32Array(input.length);
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const dt = 1 / sampleRate;
  const alpha = dt / (rc + dt);
  let prev = 0;
  for (let i = 0; i < input.length; i++) {
    prev += alpha * ((input[i] ?? 0) - prev);
    out[i] = prev;
  }
  return out;
}

function onePoleHighpass(input: Float32Array, cutoffHz: number, sampleRate: number): Float32Array {
  const out = new Float32Array(input.length);
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const dt = 1 / sampleRate;
  const beta = rc / (rc + dt);
  let prevIn = 0;
  let prevOut = 0;
  for (let i = 0; i < input.length; i++) {
    const value = beta * (prevOut + (input[i] ?? 0) - prevIn);
    prevOut = value;
    prevIn = input[i] ?? 0;
    out[i] = value;
  }
  return out;
}

function applyFilter(input: Float32Array, filter: Filter, sampleRate: number): Float32Array {
  if (filter.type === 'lowpass') return onePoleLowpass(input, filter.cutoffHz, sampleRate);
  if (filter.type === 'highpass') return onePoleHighpass(input, filter.cutoffHz, sampleRate);
  const low = onePoleLowpass(input, filter.cutoffHz, sampleRate);
  return onePoleHighpass(low, filter.cutoffHz / 4, sampleRate);
}

function renderLayer(layer: Layer, sampleCount: number, sampleRate: number, seed: number): Float32Array {
  const out = new Float32Array(sampleCount);

  if (layer.source.type === 'oscillator') {
    const { wave, freqHz, pitchEnvelope } = layer.source;
    let phase = 0;
    const sweepSamples = pitchEnvelope
      ? Math.max(1, Math.round((pitchEnvelope.timeMs / 1000) * sampleRate))
      : 0;
    for (let i = 0; i < sampleCount; i++) {
      let freq = freqHz;
      if (pitchEnvelope) {
        const t = Math.min(1, i / sweepSamples);
        freq = freqHz + (pitchEnvelope.toHz - freqHz) * t;
      }
      out[i] = waveAt(wave, phase);
      phase += freq / sampleRate;
      if (phase >= 1) phase -= Math.floor(phase);
    }
  } else {
    const rng = createRng(seed);
    if (layer.source.color === 'white') {
      for (let i = 0; i < sampleCount; i++) out[i] = rng() * 2 - 1;
    } else {
      let prev = 0;
      for (let i = 0; i < sampleCount; i++) {
        const white = rng() * 2 - 1;
        prev += 0.1 * (white - prev);
        out[i] = prev * 3;
      }
    }
  }

  const envelope = renderEnvelope(layer.envelope, sampleCount, sampleRate);
  for (let i = 0; i < sampleCount; i++) out[i] *= envelope[i] ?? 0;

  const filtered = layer.filter ? applyFilter(out, layer.filter, sampleRate) : out;
  for (let i = 0; i < sampleCount; i++) filtered[i] = (filtered[i] ?? 0) * layer.gain;
  return filtered;
}

const FADE_MS = 3;
const PEAK_CEILING = 0.891; // -1 dBFS

export function renderPatch(patch: Patch, sampleRate: number = RENDER_SAMPLE_RATE): Float32Array {
  const durationMs = Math.max(...patch.layers.map((layer) => envelopeDurationMs(layer.envelope)));
  const sampleCount = Math.max(1, Math.round((durationMs / 1000) * sampleRate));
  const mix = new Float32Array(sampleCount);

  patch.layers.forEach((layer, layerIndex) => {
    const layerOut = renderLayer(layer, sampleCount, sampleRate, 0x9e3779b9 + layerIndex * 0x1000193);
    for (let i = 0; i < sampleCount; i++) mix[i] += layerOut[i] ?? 0;
  });

  const fadeSamples = Math.max(1, Math.round((FADE_MS / 1000) * sampleRate));
  const fadeCount = Math.min(fadeSamples, sampleCount);
  for (let i = 0; i < fadeCount; i++) {
    const rampGain = i / fadeSamples;
    mix[i] = (mix[i] ?? 0) * rampGain;
    const endIndex = sampleCount - 1 - i;
    mix[endIndex] = (mix[endIndex] ?? 0) * rampGain;
  }

  let peak = 0;
  for (let i = 0; i < sampleCount; i++) peak = Math.max(peak, Math.abs(mix[i] ?? 0));
  if (peak > PEAK_CEILING) {
    const scale = PEAK_CEILING / peak;
    for (let i = 0; i < sampleCount; i++) mix[i] = (mix[i] ?? 0) * scale;
  }

  return mix;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- render.test.ts`
Expected: PASS. If the performance test is flaky in CI, re-run once; a genuine regression needs the wavetable/recurrence/xorshift techniques above, not a higher threshold.

- [ ] **Step 5: Commit**

```bash
git add src/library/render.ts src/library/render.test.ts
git commit -m "Add deterministic sample-accurate renderer with performance budget test"
```

---

## Task 6: Prose query engine (`src/library/query.ts`)

**Files:**
- Create: `src/library/query.ts`
- Test: `src/library/query.test.ts`

**Interfaces:**
- Consumes: `SoundEntry`, `SoundMatch` from `./types`; `terms`, `aliasKey`, `rawKey` from `./normalize`.
- Produces: `createSoundIndex(entries: SoundEntry[]): SoundIndex`, `searchIndex(index, query, options?): SoundMatch[]`, `bestMatch(index, query, options?): SoundMatch | null`, `LOCAL_MIN_SCORE`. The web player and `scripts/prose-probe.ts` both call `searchIndex`/`bestMatch`.

- [ ] **Step 1: Write the tests**

```ts
// src/library/query.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { createSoundIndex, searchIndex, bestMatch, LOCAL_MIN_SCORE } from './query';
import type { SoundEntry, SoundIndex } from './query';

function entry(overrides: Partial<SoundEntry>): SoundEntry {
  return {
    name: 'placeholder',
    phrase: 'placeholder',
    category: 'ui-feedback',
    concept: 'A placeholder sound used only in tests.',
    keywords: ['placeholder', 'test', 'fixture', 'stub'],
    patch: { layers: [{ source: { type: 'oscillator', wave: 'sine', freqHz: 440 }, envelope: { attackMs: 2, decayMs: 10, sustainLevel: 0, sustainMs: 0, releaseMs: 10 }, gain: 0.5 }] },
    ...overrides,
  };
}

describe('searchIndex', () => {
  let index: SoundIndex;

  beforeAll(() => {
    const entries: SoundEntry[] = [
      entry({ name: 'success-chime', phrase: 'success chime', category: 'ui-feedback', concept: 'A short rising chime for a completed action.', keywords: ['success', 'done', 'complete', 'confirm', 'checkmark'] }),
      entry({ name: 'error-buzz', phrase: 'error buzz', category: 'ui-feedback', concept: 'A short low buzz for a failed action.', keywords: ['error', 'fail', 'wrong', 'invalid', 'buzz'] }),
      entry({ name: 'kettle-whistle', phrase: 'kettle whistle', category: 'game', concept: 'A rising whistle like a kettle coming to a boil.', keywords: ['kettle', 'whistle', 'tea', 'boil', 'steam'] }),
      entry({ name: 'cup-of-tea', phrase: 'cup of tea', category: 'game', concept: 'A gentle clink for pouring a cup of tea, using a kettle.', keywords: ['tea', 'cup', 'drink', 'kettle', 'clink'] }),
    ];
    index = createSoundIndex(entries);
  });

  it('ranks an exact phrase match first', () => {
    const results = searchIndex(index, 'success chime');
    expect(results[0]?.sound.name).toBe('success-chime');
  });

  it('finds an everyday phrasing via keywords', () => {
    const results = searchIndex(index, 'something went wrong');
    expect(results[0]?.sound.name).toBe('error-buzz');
  });

  it('prefers the entry whose own phrase is named over one that only lists it as a keyword', () => {
    const results = searchIndex(index, 'kettle whistle');
    expect(results[0]?.sound.name).toBe('kettle-whistle');
  });

  it('bestMatch returns null below the score floor', () => {
    const result = bestMatch(index, 'the quiet sound of a distant galaxy forming');
    expect(result).toBeNull();
  });

  it('bestMatch returns a confident exact match', () => {
    const result = bestMatch(index, 'error buzz');
    expect(result?.sound.name).toBe('error-buzz');
    expect(result?.score).toBeGreaterThanOrEqual(LOCAL_MIN_SCORE);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- query.test.ts`
Expected: FAIL, `Cannot find module './query'`

- [ ] **Step 3: Write the implementation**

```ts
// src/library/query.ts
import type { SoundEntry, SoundMatch } from './types';
import { terms, aliasKey, rawKey } from './normalize';

export type { SoundEntry, SoundMatch };

const WEIGHT_PHRASE = 6;
const WEIGHT_KEYWORD = 4;
const WEIGHT_CATEGORY = 1;
const MAX_KEYWORD_HITS = 2;
const COVERAGE_FLOOR = 0.5;
const COVERAGE_POWER = 1.6;
const EXACT_PHRASE_BONUS = 140;
const EXACT_KEYWORD_BONUS = 100;
const SHADED_KEYWORD_BONUS = 30;
const RAW_PHRASE_BONUS = 70;
const CONTAINED_ALIAS_BONUS = 14;
const CONTAINED_PHRASE_BONUS = 40;

// Chosen provisionally; re-derived by grid search against the probe in
// scripts/tune-thresholds.ts once the seed set and probe both exist (Task 19).
// Task 19 edits this literal directly once the grid search picks a value.
export const LOCAL_MIN_SCORE = 38;

const COURTESY = new Set(['please', 'thank', 'thanks', 'sorry', 'hello', 'hi', 'ok', 'okay']);

type Posting = Map<number, number>;

export type SoundIndex = {
  entries: SoundEntry[];
  postings: Map<string, Posting>;
  documentFrequency: Map<string, number>;
  phraseAlias: Map<string, number>;
  aliasWordCount: Map<string, number>;
  totalEntries: number;
};

export type SearchOptions = {
  limit?: number;
  minScore?: number;
};

function addPosting(postings: Map<string, Posting>, term: string, entryIndex: number, weight: number): void {
  let posting = postings.get(term);
  if (!posting) {
    posting = new Map();
    postings.set(term, posting);
  }
  posting.set(entryIndex, (posting.get(entryIndex) ?? 0) + weight);
}

export function createSoundIndex(entries: SoundEntry[]): SoundIndex {
  const postings = new Map<string, Posting>();
  const documentFrequency = new Map<string, number>();
  const phraseAlias = new Map<string, number>();
  const aliasWordCount = new Map<string, number>();

  entries.forEach((entry, i) => {
    const nameWords = entry.name.replace(/-/g, ' ');
    const phraseTerms = new Set([...terms(entry.phrase), ...terms(nameWords)]);
    const phraseKey = aliasKey(entry.phrase);
    const nameKey = aliasKey(nameWords);

    for (const term of phraseTerms) addPosting(postings, term, i, WEIGHT_PHRASE);
    if (!phraseAlias.has(phraseKey)) phraseAlias.set(phraseKey, i);
    if (!phraseAlias.has(nameKey)) phraseAlias.set(nameKey, i);
    aliasWordCount.set(phraseKey, phraseKey.split(' ').filter(Boolean).length);

    for (const term of terms(entry.category)) addPosting(postings, term, i, WEIGHT_CATEGORY);

    const keywordHits = new Map<string, number>();
    for (const keyword of entry.keywords) {
      const kwKey = aliasKey(keyword);
      aliasWordCount.set(kwKey, kwKey.split(' ').filter(Boolean).length);
      for (const term of terms(keyword)) {
        keywordHits.set(term, (keywordHits.get(term) ?? 0) + 1);
      }
    }
    for (const [term, hits] of keywordHits) {
      addPosting(postings, term, i, WEIGHT_KEYWORD * Math.min(hits, MAX_KEYWORD_HITS));
    }
  });

  for (const [term, posting] of postings) {
    documentFrequency.set(term, posting.size);
  }

  return { entries, postings, documentFrequency, phraseAlias, aliasWordCount, totalEntries: entries.length };
}

function rarity(index: SoundIndex, term: string): number {
  const df = index.documentFrequency.get(term) ?? index.totalEntries;
  return Math.log(1 + index.totalEntries / Math.max(df, 1));
}

function coverageMultiplier(matchedCount: number, queryCount: number): number {
  if (queryCount === 0) return 0;
  const coverage = matchedCount / queryCount;
  return COVERAGE_FLOOR + (1 - COVERAGE_FLOOR) * Math.pow(coverage, COVERAGE_POWER);
}

function containsRun(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

export function searchIndex(index: SoundIndex, query: string, options: SearchOptions = {}): SoundMatch[] {
  const limit = options.limit ?? 10;
  const minScore = options.minScore ?? -Infinity;
  const queryTerms = terms(query);
  const queryTermSet = new Set(queryTerms);
  const queryKey = aliasKey(query);
  const rawQueryKey = rawKey(query);

  const scores = new Map<number, number>();
  const matchedTerms = new Map<number, Set<string>>();

  for (const term of queryTermSet) {
    const posting = index.postings.get(term);
    if (!posting) continue;
    const r = rarity(index, term);
    for (const [entryIndex, weight] of posting) {
      scores.set(entryIndex, (scores.get(entryIndex) ?? 0) + weight * r);
      const set = matchedTerms.get(entryIndex) ?? new Set<string>();
      set.add(term);
      matchedTerms.set(entryIndex, set);
    }
  }

  const results: SoundMatch[] = [];
  for (const [entryIndex, rawScore] of scores) {
    const matched = matchedTerms.get(entryIndex) ?? new Set<string>();
    let score = rawScore * coverageMultiplier(matched.size, queryTermSet.size);

    const entry = index.entries[entryIndex];
    if (!entry) continue;
    const phraseKey = aliasKey(entry.phrase);

    if (queryKey.length > 0 && queryKey === phraseKey) {
      score += EXACT_PHRASE_BONUS;
    }

    for (const keyword of entry.keywords) {
      if (queryKey.length > 0 && aliasKey(keyword) === queryKey) {
        const namesOtherPhrase = [...index.phraseAlias.keys()].some(
          (key) => key !== phraseKey && key.length > 0 && !COURTESY.has(key) && queryKey.includes(key)
        );
        score += namesOtherPhrase ? SHADED_KEYWORD_BONUS : EXACT_KEYWORD_BONUS;
        break;
      }
    }

    const rawPhraseKey = rawKey(entry.phrase);
    if (rawQueryKey.length > 0 && rawQueryKey === rawPhraseKey) {
      score += RAW_PHRASE_BONUS;
    }

    const wordCount = index.aliasWordCount.get(phraseKey) ?? phraseKey.split(' ').filter(Boolean).length;
    if (phraseKey.length > 0 && containsRun(queryTerms, phraseKey.split(' '))) {
      score += CONTAINED_PHRASE_BONUS * wordCount;
    }
    for (const keyword of entry.keywords) {
      const kwKey = aliasKey(keyword);
      const kwWordCount = kwKey.split(' ').filter(Boolean).length;
      if (kwWordCount > 1 && containsRun(queryTerms, kwKey.split(' '))) {
        score += CONTAINED_ALIAS_BONUS * kwWordCount;
        break;
      }
    }

    results.push({ sound: entry, score, matched: [...matched] });
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.sound.phrase.length !== b.sound.phrase.length) return a.sound.phrase.length - b.sound.phrase.length;
    return a.sound.name.localeCompare(b.sound.name);
  });

  return results.filter((r) => r.score >= minScore).slice(0, limit);
}

export function bestMatch(index: SoundIndex, query: string, options: SearchOptions = {}): SoundMatch | null {
  const minScore = options.minScore ?? LOCAL_MIN_SCORE;
  const [top] = searchIndex(index, query, { limit: 1 });
  if (!top || top.score < minScore) return null;
  return top;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- query.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/library/query.ts src/library/query.test.ts
git commit -m "Add lexical prose query engine adapted from semantic-icons"
```

---

## Task 7: Validator (`src/library/validate.ts`)

**Files:**
- Create: `src/library/validate.ts`
- Test: `src/library/validate.test.ts`

**Interfaces:**
- Consumes: `SoundEntry`, layer/envelope bounds constants from `./types`; `renderPatch` from `./render`; `normalizePhrase` from `./normalize-phrase`.
- Produces: `checkEntry(entry: SoundEntry): string[]`, `checkLibrary(entries: SoundEntry[]): Map<string, string[]>`, `computeDescriptors(samples: Float32Array, sampleRate: number): Descriptors`. `scripts/check-library.mjs` (Task 18) and the seed-authoring tasks (Tasks 12-17) both call `checkEntry`/`checkLibrary`.

- [ ] **Step 1: Write the tests**

```ts
// src/library/validate.test.ts
import { describe, it, expect } from 'vitest';
import { checkEntry, checkLibrary, computeDescriptors } from './validate';
import { renderPatch } from './render';
import type { SoundEntry } from './types';

function validEntry(overrides: Partial<SoundEntry> = {}): SoundEntry {
  return {
    name: 'tap',
    phrase: 'tap',
    category: 'ui-feedback',
    concept: 'A single soft click for a light UI tap.',
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

describe('checkEntry', () => {
  it('accepts a well-formed entry', () => {
    expect(checkEntry(validEntry())).toEqual([]);
  });

  it('rejects a name that is not kebab-case', () => {
    const problems = checkEntry(validEntry({ name: 'Tap_Sound' }));
    expect(problems.some((p) => p.includes('kebab-case'))).toBe(true);
  });

  it('rejects too few keywords', () => {
    const problems = checkEntry(validEntry({ keywords: ['click'] }));
    expect(problems.some((p) => p.includes('keyword'))).toBe(true);
  });

  it('rejects a concept shorter than 20 characters', () => {
    const problems = checkEntry(validEntry({ concept: 'Too short.' }));
    expect(problems.some((p) => p.includes('20 characters'))).toBe(true);
  });

  it('rejects a patch with too many layers', () => {
    const layer = validEntry().patch.layers[0]!;
    const problems = checkEntry(validEntry({ patch: { layers: [layer, layer, layer, layer, layer] } }));
    expect(problems.some((p) => p.includes('layers'))).toBe(true);
  });

  it('rejects a duration outside the contract range', () => {
    const problems = checkEntry(
      validEntry({
        patch: {
          layers: [
            {
              source: { type: 'oscillator', wave: 'sine', freqHz: 440 },
              envelope: { attackMs: 500, decayMs: 500, sustainLevel: 0.5, sustainMs: 500, releaseMs: 500 },
              gain: 0.5,
            },
          ],
        },
      })
    );
    expect(problems.some((p) => p.includes('duration'))).toBe(true);
  });

  it('flags a concept that claims "rising" over a falling or steady pitch', () => {
    const problems = checkEntry(
      validEntry({
        concept: 'A rising tone that climbs upward with confidence and energy.',
        patch: {
          layers: [
            {
              source: { type: 'oscillator', wave: 'sine', freqHz: 800 },
              envelope: { attackMs: 5, decayMs: 20, sustainLevel: 0.4, sustainMs: 40, releaseMs: 20 },
              gain: 0.6,
            },
          ],
        },
      })
    );
    expect(problems.some((p) => p.includes('rising'))).toBe(true);
  });

  it('accepts a concept that claims "rising" over an actually rising pitch sweep', () => {
    const problems = checkEntry(
      validEntry({
        concept: 'A rising tone that climbs upward with confidence and energy.',
        patch: {
          layers: [
            {
              source: { type: 'oscillator', wave: 'sine', freqHz: 300, pitchEnvelope: { toHz: 1200, timeMs: 80 } },
              envelope: { attackMs: 5, decayMs: 20, sustainLevel: 0.4, sustainMs: 40, releaseMs: 20 },
              gain: 0.6,
            },
          ],
        },
      })
    );
    expect(problems.some((p) => p.includes('rising'))).toBe(false);
  });
});

describe('computeDescriptors', () => {
  it('reports duration close to the rendered sample count', () => {
    const patch = validEntry().patch;
    const samples = renderPatch(patch);
    const descriptors = computeDescriptors(samples, 48000);
    expect(descriptors.durationMs).toBeGreaterThan(0);
    expect(descriptors.durationMs).toBeLessThan(100);
  });
});

describe('checkLibrary', () => {
  it('flags a duplicate name across entries', () => {
    const problems = checkLibrary([validEntry(), validEntry({ phrase: 'tap two' })]);
    const messages = [...problems.values()].flat();
    expect(messages.some((m) => m.includes('duplicate name'))).toBe(true);
  });

  it('flags a duplicate phrase across entries even with different casing/spacing', () => {
    const problems = checkLibrary([validEntry(), validEntry({ name: 'tap-two', phrase: '  Tap ' })]);
    const messages = [...problems.values()].flat();
    expect(messages.some((m) => m.includes('duplicate phrase'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- validate.test.ts`
Expected: FAIL, `Cannot find module './validate'`

- [ ] **Step 3: Write the implementation**

```ts
// src/library/validate.ts
import type { SoundEntry } from './types';
import { MAX_FREQ_HZ, MAX_LAYERS, MIN_FREQ_HZ, MIN_LAYERS, RENDER_SAMPLE_RATE } from './types';
import { renderPatch } from './render';
import { normalizePhrase } from './normalize-phrase';

export const MIN_DURATION_MS = 30;
export const MAX_DURATION_MS = 1500;
export const PEAK_CEILING = 0.891; // -1 dBFS
export const RMS_MIN_DB = -20;
export const RMS_MAX_DB = -14;
export const MAX_DC_OFFSET = 0.001;
export const MIN_KEYWORDS = 4;
export const MIN_CONCEPT_LENGTH = 20;
export const BRIGHTNESS_THRESHOLD_HZ = 1500;
export const DURATION_SHORT_MS = 200;
export const DURATION_LONG_MS = 800;

const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type PitchDirection = 'rising' | 'falling' | 'steady';
export type Attack = 'soft' | 'sharp';

export type Descriptors = {
  durationMs: number;
  peak: number;
  rmsDb: number;
  dcOffset: number;
  brightnessHz: number;
  pitchDirection: PitchDirection;
  attack: Attack;
};

function spectralCentroid(samples: Float32Array, sampleRate: number): number {
  const BIN_COUNT = 64;
  const maxFreq = sampleRate / 2;
  const stride = Math.max(1, Math.floor(samples.length / 4096));
  const magnitudes = new Float32Array(BIN_COUNT);

  for (let k = 0; k < BIN_COUNT; k++) {
    const freq = ((k + 1) / BIN_COUNT) * maxFreq;
    const omega = (2 * Math.PI * freq) / sampleRate;
    let real = 0;
    let imag = 0;
    let count = 0;
    for (let i = 0; i < samples.length; i += stride) {
      const sample = samples[i] ?? 0;
      real += sample * Math.cos(omega * i);
      imag -= sample * Math.sin(omega * i);
      count++;
    }
    magnitudes[k] = count > 0 ? Math.sqrt(real * real + imag * imag) / count : 0;
  }

  let weightedSum = 0;
  let totalMagnitude = 0;
  for (let k = 0; k < BIN_COUNT; k++) {
    const freq = ((k + 1) / BIN_COUNT) * maxFreq;
    weightedSum += freq * (magnitudes[k] ?? 0);
    totalMagnitude += magnitudes[k] ?? 0;
  }
  return totalMagnitude > 0 ? weightedSum / totalMagnitude : 0;
}

function zeroCrossingRate(samples: Float32Array, sampleRate: number, start: number, end: number): number {
  let crossings = 0;
  for (let i = start + 1; i < end; i++) {
    const prev = samples[i - 1] ?? 0;
    const current = samples[i] ?? 0;
    if ((prev < 0 && current >= 0) || (prev >= 0 && current < 0)) crossings++;
  }
  const durationSec = (end - start) / sampleRate;
  return durationSec > 0 ? crossings / 2 / durationSec : 0;
}

function estimatePitchDirection(samples: Float32Array, sampleRate: number): PitchDirection {
  const third = Math.floor(samples.length / 3);
  if (third < 4) return 'steady';
  const startFreq = zeroCrossingRate(samples, sampleRate, 0, third);
  const endFreq = zeroCrossingRate(samples, sampleRate, samples.length - third, samples.length);
  const ratio = endFreq / Math.max(startFreq, 1e-6);
  if (ratio > 1.15) return 'rising';
  if (ratio < 0.87) return 'falling';
  return 'steady';
}

function estimateAttack(samples: Float32Array): Attack {
  let peakIndex = 0;
  let peakValue = 0;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i] ?? 0);
    if (abs > peakValue) {
      peakValue = abs;
      peakIndex = i;
    }
  }
  const attackFraction = samples.length > 0 ? peakIndex / samples.length : 0;
  return attackFraction < 0.08 ? 'sharp' : 'soft';
}

export function computeDescriptors(samples: Float32Array, sampleRate: number): Descriptors {
  let peak = 0;
  let sumSquares = 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i] ?? 0;
    peak = Math.max(peak, Math.abs(sample));
    sumSquares += sample * sample;
    sum += sample;
  }
  const rms = Math.sqrt(sumSquares / Math.max(samples.length, 1));
  const rmsDb = 20 * Math.log10(Math.max(rms, 1e-9));
  const dcOffset = sum / Math.max(samples.length, 1);

  return {
    durationMs: (samples.length / sampleRate) * 1000,
    peak,
    rmsDb,
    dcOffset,
    brightnessHz: spectralCentroid(samples, sampleRate),
    pitchDirection: estimatePitchDirection(samples, sampleRate),
    attack: estimateAttack(samples),
  };
}

const CONCEPT_VOCABULARY: Array<{ words: string[]; check: (d: Descriptors) => boolean; label: string }> = [
  { words: ['rising', 'ascending'], check: (d) => d.pitchDirection === 'rising', label: 'a rising pitch' },
  { words: ['falling', 'descending'], check: (d) => d.pitchDirection === 'falling', label: 'a falling pitch' },
  { words: ['soft', 'gentle'], check: (d) => d.attack === 'soft', label: 'a soft attack' },
  { words: ['sharp', 'percussive'], check: (d) => d.attack === 'sharp', label: 'a sharp attack' },
  { words: ['bright'], check: (d) => d.brightnessHz >= BRIGHTNESS_THRESHOLD_HZ, label: 'a bright timbre' },
  { words: ['dark', 'warm'], check: (d) => d.brightnessHz < BRIGHTNESS_THRESHOLD_HZ, label: 'a dark timbre' },
  { words: ['short', 'quick'], check: (d) => d.durationMs <= DURATION_SHORT_MS, label: `a duration under ${DURATION_SHORT_MS}ms` },
  { words: ['long', 'sustained'], check: (d) => d.durationMs >= DURATION_LONG_MS, label: `a duration over ${DURATION_LONG_MS}ms` },
];

function checkConceptAgreement(concept: string, descriptors: Descriptors): string[] {
  const problems: string[] = [];
  const lowerConcept = concept.toLowerCase();
  for (const item of CONCEPT_VOCABULARY) {
    if (item.words.some((word) => lowerConcept.includes(word)) && !item.check(descriptors)) {
      problems.push(`concept mentions "${item.words[0]}" but the patch does not produce ${item.label}`);
    }
  }
  return problems;
}

export function checkEntry(entry: SoundEntry): string[] {
  const problems: string[] = [];

  if (!NAME_PATTERN.test(entry.name)) problems.push(`name "${entry.name}" must be kebab-case`);
  if (!NAME_PATTERN.test(entry.category)) problems.push(`category "${entry.category}" must be kebab-case`);
  if (entry.phrase.trim().length === 0) problems.push('phrase must not be empty');
  if (entry.concept.trim().length < MIN_CONCEPT_LENGTH) {
    problems.push(`concept must be at least ${MIN_CONCEPT_LENGTH} characters`);
  }
  if (entry.keywords.length < MIN_KEYWORDS) {
    problems.push(`needs at least ${MIN_KEYWORDS} keywords, has ${entry.keywords.length}`);
  }
  const seenKeywords = new Set<string>();
  for (const keyword of entry.keywords) {
    if (keyword !== keyword.trim().toLowerCase()) problems.push(`keyword "${keyword}" must be lowercase and trimmed`);
    if (seenKeywords.has(keyword)) problems.push(`duplicate keyword "${keyword}"`);
    seenKeywords.add(keyword);
  }
  if (entry.patch.layers.length < MIN_LAYERS || entry.patch.layers.length > MAX_LAYERS) {
    problems.push(`patch must have ${MIN_LAYERS}-${MAX_LAYERS} layers, has ${entry.patch.layers.length}`);
  }
  for (const layer of entry.patch.layers) {
    if (layer.source.type === 'oscillator') {
      if (layer.source.freqHz < MIN_FREQ_HZ || layer.source.freqHz > MAX_FREQ_HZ) {
        problems.push(`oscillator freqHz ${layer.source.freqHz} out of range ${MIN_FREQ_HZ}-${MAX_FREQ_HZ}`);
      }
    }
    if (layer.gain < 0 || layer.gain > 1) problems.push(`layer gain ${layer.gain} must be 0-1`);
  }

  let samples: Float32Array;
  try {
    samples = renderPatch(entry.patch);
  } catch (error) {
    problems.push(`patch failed to render: ${(error as Error).message}`);
    return problems;
  }

  const descriptors = computeDescriptors(samples, RENDER_SAMPLE_RATE);

  if (descriptors.durationMs < MIN_DURATION_MS || descriptors.durationMs > MAX_DURATION_MS) {
    problems.push(`duration ${descriptors.durationMs.toFixed(0)}ms out of range ${MIN_DURATION_MS}-${MAX_DURATION_MS}ms`);
  }
  if (descriptors.peak > PEAK_CEILING) {
    problems.push(`peak ${descriptors.peak.toFixed(3)} exceeds ceiling ${PEAK_CEILING}`);
  }
  if (descriptors.rmsDb < RMS_MIN_DB || descriptors.rmsDb > RMS_MAX_DB) {
    problems.push(`loudness ${descriptors.rmsDb.toFixed(1)}dB outside target window ${RMS_MIN_DB} to ${RMS_MAX_DB}dB`);
  }
  if (Math.abs(descriptors.dcOffset) > MAX_DC_OFFSET) {
    problems.push(`DC offset ${descriptors.dcOffset.toFixed(4)} exceeds ${MAX_DC_OFFSET}`);
  }
  if (Math.abs(samples[0] ?? 0) > 0.01 || Math.abs(samples[samples.length - 1] ?? 0) > 0.01) {
    problems.push('start or end sample is not faded to near zero');
  }

  problems.push(...checkConceptAgreement(entry.concept, descriptors));

  return problems;
}

export function checkLibrary(entries: SoundEntry[]): Map<string, string[]> {
  const results = new Map<string, string[]>();
  const seenNames = new Set<string>();
  const seenPhrases = new Set<string>();

  entries.forEach((entry, index) => {
    const key = `${index}: ${entry.name}`;
    const problems = checkEntry(entry);

    if (seenNames.has(entry.name)) problems.push(`duplicate name "${entry.name}"`);
    seenNames.add(entry.name);

    const phraseKey = normalizePhrase(entry.phrase);
    if (seenPhrases.has(phraseKey)) problems.push(`duplicate phrase "${entry.phrase}"`);
    seenPhrases.add(phraseKey);

    if (problems.length > 0) results.set(key, problems);
  });

  return results;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- validate.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/library/validate.ts src/library/validate.test.ts
git commit -m "Add contract validator with descriptor computation and concept agreement check"
```

---

## Task 8: Sound style guide (`docs/sound-style-guide.md`)

**Files:**
- Create: `docs/sound-style-guide.md`

**Interfaces:**
- Consumes: the constants from Tasks 2 and 7 (durations, peak, loudness, layer count) — copy the exact values, do not restate them from memory.
- Produces: the document Tasks 12-17 (seed authoring) follow.

- [ ] **Step 1: Write the style guide**

```markdown
# Sound style guide

Every sound in Semantic Sounds follows this guide. It has hard rules the
validator checks, and soft rules for judgment.

## Sonic style

Soft and rounded synth. Sine and triangle tones, gentle attacks, gentle
low-pass filtering. Warm and unobtrusive, in the register of macOS/iOS
system sounds. Avoid harsh square/saw waves as a primary tone; use them
only as a secondary texture layer, filtered down.

## Hard rules (the validator enforces these)

- Duration: 30ms to 1500ms.
- Layers: 1 to 4.
- Peak: at or below -1 dBFS (0.891 linear). The renderer already limits
  this; do not fight it with extreme gain values.
- Loudness: RMS between -20 and -14 dBFS. If your sound reads as too
  quiet or too loud once rendered, adjust `gain` and `sustainLevel`, not
  the contract.
- No DC offset: a symmetrical waveform. Oscillators and the noise
  generator already produce this; do not add a constant offset.
- No click: the renderer fades the first and last 3ms automatically. Do
  not rely on your own envelope to reach exactly zero at the edges.
- Metadata: `name` and `category` are kebab-case. `concept` is at least
  20 characters. At least 4 keywords. No duplicate `name` or `phrase`
  across the library.
- Concept agreement: if `concept` uses a word like "rising", "falling",
  "soft", "sharp", "bright", "dark"/"warm", "short", or "long", the
  patch must actually produce that. A pitch sweep needs a
  `pitchEnvelope`; a claimed short sound needs a short duration. The
  validator checks this because a model cannot hear its own output.

## Soft rules (judgment, not machine-checked)

- Register: aim for a shared middle register across the set (roughly
  200-1000 Hz for tone layers) so sounds feel related when played one
  after another. This is a guideline, not a validator rule.
- Attack character: match the chosen sonic style. A "sharp" attack
  should still feel soft-edged, not harsh, at this style's level.
- Per-layer purpose: a tone layer (oscillator) carries pitch identity;
  a noise layer carries texture or a transient (a click, a whoosh).
  Don't use noise as the only layer for a sound whose concept is about
  pitch.
- Recognizability: with the name covered, would a listener guess the
  intended feeling (success, error, urgency, calm) from the sound
  alone? If not, the envelope or pitch choice likely needs to be more
  distinct, not louder.

## Entry format

```json
{
  "name": "success-chime",
  "phrase": "success chime",
  "category": "ui-feedback",
  "concept": "A short, soft, rising chime for a completed action.",
  "keywords": ["success", "done", "complete", "confirm", "checkmark", "saved", "finished"],
  "patch": {
    "layers": [
      {
        "source": { "type": "oscillator", "wave": "sine", "freqHz": 500, "pitchEnvelope": { "toHz": 900, "timeMs": 90 } },
        "envelope": { "attackMs": 4, "decayMs": 40, "sustainLevel": 0.3, "sustainMs": 40, "releaseMs": 60 },
        "gain": 0.7
      }
    ]
  }
}
```

## Keyword-writing guidance

Same discipline as the icon set's keywords, because the same query
engine (`src/library/query.ts`) reads them:

- Write 5-10 keywords: synonyms, related product words, and phrases a
  caller would actually type ("the upload finished", not just
  "upload").
- Don't repeat the phrase itself; it is already indexed.
- Don't add plurals or verb tenses; the stemmer handles those
  (`stem('running') === 'run'`).
- Name the sound's own subject, not a scene around it. A game "coin
  pickup" sound should list "coin", "pickup", "collect" — not "game"
  or "screen", which would steal queries meant for other entries.
- Keep every keyword lowercase and trimmed; the validator rejects
  anything else.

## Common failures

| Symptom | Fix |
|---|---|
| Validator says "duration out of range" | Check every layer's `attackMs+decayMs+sustainMs+releaseMs`; the patch's duration is the longest of these. |
| Validator says "loudness ... outside target window" | Raise or lower `gain`/`sustainLevel`, not the contract constants. |
| Validator says "concept mentions ... but the patch does not produce ..." | Either change the wording in `concept`, or add/adjust a `pitchEnvelope` (for rising/falling) or shorten/lengthen the envelope (for short/long). |
| Sound is hard to identify blind | Give the tone layer a more distinct pitch or pitch movement; don't just raise the volume. |
```

- [ ] **Step 2: Commit**

```bash
git add docs/sound-style-guide.md
git commit -m "Write the sound style guide"
```

---

## Task 9: Batch authoring brief and phrase lists

**Files:**
- Create: `docs/sound-batches/AGENT_BRIEF.md`
- Create: `docs/sound-batches/ui-feedback.json`
- Create: `docs/sound-batches/messages-notifications.json`
- Create: `docs/sound-batches/progress.json`
- Create: `docs/sound-batches/transitions.json`
- Create: `docs/sound-batches/timers-alarms.json`
- Create: `docs/sound-batches/game.json`

**Interfaces:**
- Consumes: `docs/sound-style-guide.md` (Task 8).
- Produces: the phrase lists and output-file paths Tasks 12-17 read.

- [ ] **Step 1: Write the six batch phrase-list files**

```json
// docs/sound-batches/ui-feedback.json
{
  "category": "ui-feedback",
  "outputFile": "src/library/sounds/ui-feedback.json",
  "phrases": [
    { "name": "success-chime", "phrase": "success chime" },
    { "name": "error-buzz", "phrase": "error buzz" },
    { "name": "warning-ping", "phrase": "warning ping" },
    { "name": "tap", "phrase": "tap" },
    { "name": "toggle-on", "phrase": "toggle on" },
    { "name": "toggle-off", "phrase": "toggle off" },
    { "name": "delete", "phrase": "delete" }
  ]
}
```

```json
// docs/sound-batches/messages-notifications.json
{
  "category": "messages-notifications",
  "outputFile": "src/library/sounds/messages-notifications.json",
  "phrases": [
    { "name": "message-received", "phrase": "message received" },
    { "name": "notification-ping", "phrase": "notification ping" },
    { "name": "mention-alert", "phrase": "mention alert" },
    { "name": "direct-message", "phrase": "direct message" },
    { "name": "calendar-reminder", "phrase": "calendar reminder" },
    { "name": "mute-confirmation", "phrase": "mute confirmation" }
  ]
}
```

```json
// docs/sound-batches/progress.json
{
  "category": "progress",
  "outputFile": "src/library/sounds/progress.json",
  "phrases": [
    { "name": "upload-complete", "phrase": "upload complete" },
    { "name": "download-complete", "phrase": "download complete" },
    { "name": "level-up", "phrase": "level up" },
    { "name": "coin-pickup", "phrase": "coin pickup" },
    { "name": "achievement-unlocked", "phrase": "achievement unlocked" },
    { "name": "task-complete", "phrase": "task complete" },
    { "name": "sync-complete", "phrase": "sync complete" }
  ]
}
```

```json
// docs/sound-batches/transitions.json
{
  "category": "transitions",
  "outputFile": "src/library/sounds/transitions.json",
  "phrases": [
    { "name": "menu-open", "phrase": "menu open" },
    { "name": "menu-close", "phrase": "menu close" },
    { "name": "panel-slide-in", "phrase": "panel slide in" },
    { "name": "panel-slide-out", "phrase": "panel slide out" },
    { "name": "tab-switch", "phrase": "tab switch" },
    { "name": "modal-open", "phrase": "modal open" },
    { "name": "modal-close", "phrase": "modal close" }
  ]
}
```

```json
// docs/sound-batches/timers-alarms.json
{
  "category": "timers-alarms",
  "outputFile": "src/library/sounds/timers-alarms.json",
  "phrases": [
    { "name": "key-press", "phrase": "key press" },
    { "name": "message-typing", "phrase": "message typing" },
    { "name": "timer-tick", "phrase": "timer tick" },
    { "name": "timer-done", "phrase": "timer done" },
    { "name": "alarm", "phrase": "alarm" },
    { "name": "countdown-beep", "phrase": "countdown beep" },
    { "name": "snooze", "phrase": "snooze" }
  ]
}
```

```json
// docs/sound-batches/game.json
{
  "category": "game",
  "outputFile": "src/library/sounds/game.json",
  "phrases": [
    { "name": "jump", "phrase": "jump" },
    { "name": "power-up", "phrase": "power up" },
    { "name": "coin-combo", "phrase": "coin combo" },
    { "name": "game-over", "phrase": "game over" },
    { "name": "victory-fanfare", "phrase": "victory fanfare" },
    { "name": "extra-life", "phrase": "extra life" }
  ]
}
```

- [ ] **Step 2: Write the agent brief**

```markdown
// docs/sound-batches/AGENT_BRIEF.md
# Sound batch authoring brief

You are authoring one category batch of the Semantic Sounds seed set.

1. Read `docs/sound-style-guide.md` in full before writing anything.
2. Read your batch file under `docs/sound-batches/<category>.json`. It
   lists the `name`, `phrase`, and `outputFile` for every sound in your
   batch. Write one entry per phrase.
3. Each entry needs: `name`, `phrase`, `category` (from the batch
   file), `concept` (>= 20 characters, matching the style guide's
   concept-agreement rules), `keywords` (>= 4, following the
   keyword-writing guidance), and `patch` (1-4 layers, following the
   entry format example).
4. Write your batch's `outputFile` as a JSON array of entries as soon
   as every entry in it passes `node scripts/check-library.mjs
   <outputFile>` with zero problems. The checker prints every problem
   for every entry; fix all of them, don't stop at the first.
   Write the file the moment it fully passes, then keep refining only
   by re-writing the same file — a parent process can stop you at any
   time, and only a written file survives that.
5. Expect to redraw (rewrite the patch for) about a third of your
   entries after first hearing them. A batch with no rewrites means
   you judged too kindly the first time — actually render and reason
   through what each patch sounds like (attack speed, pitch movement,
   layer balance) before accepting it.
6. If a phrase genuinely cannot be made distinct and pass the contract
   after real effort, report it back rather than shipping something
   that doesn't work. Say which phrase and why.
7. Only touch your own `outputFile`. Do not edit the style guide, the
   validator, other batches' output files, or run git commands.
8. Report back: the output file path, how many entries you wrote, and
   any phrase you could not make work.
```

- [ ] **Step 3: Commit**

```bash
git add docs/sound-batches
git commit -m "Add sound batch authoring brief and 40-phrase seed taxonomy"
```

---

## Task 10: Library check script (`scripts/check-library.mjs`)

**Files:**
- Create: `scripts/check-library.mjs`

**Interfaces:**
- Consumes: `checkEntry`/`checkLibrary` from the built library (imports from `../dist/index.js` after `npm run build`, so this script must be run after a build, or via `tsx` against the source — this plan uses `tsx` against source directly to avoid a build step during authoring).

- [ ] **Step 1: Write the script**

```js
#!/usr/bin/env node
// scripts/check-library.mjs
// Usage: node scripts/check-library.mjs [path/to/file.json ...]
// With no arguments, checks every file under src/library/sounds/*.json.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('tsx/esm', pathToFileURL('./'));
const { checkEntry } = await import('../src/library/validate.ts');

const soundsDir = join(process.cwd(), 'src', 'library', 'sounds');
const targetFiles =
  process.argv.length > 2
    ? process.argv.slice(2)
    : readdirSync(soundsDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => join(soundsDir, f));

let totalProblems = 0;
let totalEntries = 0;

for (const file of targetFiles) {
  const entries = JSON.parse(readFileSync(file, 'utf8'));
  for (const entry of entries) {
    totalEntries++;
    const problems = checkEntry(entry);
    if (problems.length > 0) {
      totalProblems += problems.length;
      console.log(`${file} :: ${entry.name}`);
      for (const problem of problems) console.log(`  - ${problem}`);
    }
  }
}

console.log(`\n${totalEntries} entries checked, ${totalProblems} problems found.`);
process.exit(totalProblems > 0 ? 1 : 0);
```

- [ ] **Step 2: Verify it runs against an empty directory without crashing**

Run: `mkdir -p src/library/sounds && node scripts/check-library.mjs`
Expected: prints "0 entries checked, 0 problems found." and exits 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/check-library.mjs
git commit -m "Add library check script for validating sound batch files"
```

---

## Tasks 11-16: Author the six seed batches

Each of these six tasks is independent of the others (they touch only
their own output file) and can be executed in parallel once Tasks 1-10
are complete. Each follows the same pattern; only the batch file and
category differ.

### Task 11: UI feedback batch

**Files:**
- Create: `src/library/sounds/ui-feedback.json`

**Interfaces:**
- Consumes: `docs/sound-batches/ui-feedback.json` (phrase list), `docs/sound-batches/AGENT_BRIEF.md` (process), `docs/sound-style-guide.md` (rules).
- Produces: 7 `SoundEntry` objects matching the phrases in `docs/sound-batches/ui-feedback.json`.

- [ ] **Step 1: Follow `docs/sound-batches/AGENT_BRIEF.md`** for the `ui-feedback` batch: write `src/library/sounds/ui-feedback.json` as a JSON array of 7 entries (success-chime, error-buzz, warning-ping, tap, toggle-on, toggle-off, delete), each matching the entry format in the style guide.

- [ ] **Step 2: Validate**

Run: `node scripts/check-library.mjs src/library/sounds/ui-feedback.json`
Expected: `7 entries checked, 0 problems found.`

- [ ] **Step 3: Commit**

```bash
git add src/library/sounds/ui-feedback.json
git commit -m "Add UI feedback seed sounds"
```

### Task 12: Messages and notifications batch

**Files:**
- Create: `src/library/sounds/messages-notifications.json`

**Interfaces:**
- Consumes: `docs/sound-batches/messages-notifications.json`, `docs/sound-batches/AGENT_BRIEF.md`, `docs/sound-style-guide.md`.
- Produces: 6 `SoundEntry` objects (message-received, notification-ping, mention-alert, direct-message, calendar-reminder, mute-confirmation).

- [ ] **Step 1: Follow the brief** for the `messages-notifications` batch, writing `src/library/sounds/messages-notifications.json`.
- [ ] **Step 2: Validate**

Run: `node scripts/check-library.mjs src/library/sounds/messages-notifications.json`
Expected: `6 entries checked, 0 problems found.`

- [ ] **Step 3: Commit**

```bash
git add src/library/sounds/messages-notifications.json
git commit -m "Add messages and notifications seed sounds"
```

### Task 13: Progress batch

**Files:**
- Create: `src/library/sounds/progress.json`

**Interfaces:**
- Consumes: `docs/sound-batches/progress.json`, `docs/sound-batches/AGENT_BRIEF.md`, `docs/sound-style-guide.md`.
- Produces: 7 `SoundEntry` objects (upload-complete, download-complete, level-up, coin-pickup, achievement-unlocked, task-complete, sync-complete).

- [ ] **Step 1: Follow the brief** for the `progress` batch, writing `src/library/sounds/progress.json`.
- [ ] **Step 2: Validate**

Run: `node scripts/check-library.mjs src/library/sounds/progress.json`
Expected: `7 entries checked, 0 problems found.`

- [ ] **Step 3: Commit**

```bash
git add src/library/sounds/progress.json
git commit -m "Add progress seed sounds"
```

### Task 14: Transitions batch

**Files:**
- Create: `src/library/sounds/transitions.json`

**Interfaces:**
- Consumes: `docs/sound-batches/transitions.json`, `docs/sound-batches/AGENT_BRIEF.md`, `docs/sound-style-guide.md`.
- Produces: 7 `SoundEntry` objects (menu-open, menu-close, panel-slide-in, panel-slide-out, tab-switch, modal-open, modal-close).

- [ ] **Step 1: Follow the brief** for the `transitions` batch, writing `src/library/sounds/transitions.json`.
- [ ] **Step 2: Validate**

Run: `node scripts/check-library.mjs src/library/sounds/transitions.json`
Expected: `7 entries checked, 0 problems found.`

- [ ] **Step 3: Commit**

```bash
git add src/library/sounds/transitions.json
git commit -m "Add transition seed sounds"
```

### Task 15: Typing, timers, and alarms batch

**Files:**
- Create: `src/library/sounds/timers-alarms.json`

**Interfaces:**
- Consumes: `docs/sound-batches/timers-alarms.json`, `docs/sound-batches/AGENT_BRIEF.md`, `docs/sound-style-guide.md`.
- Produces: 7 `SoundEntry` objects (key-press, message-typing, timer-tick, timer-done, alarm, countdown-beep, snooze).

- [ ] **Step 1: Follow the brief** for the `timers-alarms` batch, writing `src/library/sounds/timers-alarms.json`.
- [ ] **Step 2: Validate**

Run: `node scripts/check-library.mjs src/library/sounds/timers-alarms.json`
Expected: `7 entries checked, 0 problems found.`

- [ ] **Step 3: Commit**

```bash
git add src/library/sounds/timers-alarms.json
git commit -m "Add typing, timer, and alarm seed sounds"
```

### Task 16: Game batch

**Files:**
- Create: `src/library/sounds/game.json`

**Interfaces:**
- Consumes: `docs/sound-batches/game.json`, `docs/sound-batches/AGENT_BRIEF.md`, `docs/sound-style-guide.md`.
- Produces: 6 `SoundEntry` objects (jump, power-up, coin-combo, game-over, victory-fanfare, extra-life).

- [ ] **Step 1: Follow the brief** for the `game` batch, writing `src/library/sounds/game.json`.
- [ ] **Step 2: Validate**

Run: `node scripts/check-library.mjs src/library/sounds/game.json`
Expected: `6 entries checked, 0 problems found.`

- [ ] **Step 3: Commit**

```bash
git add src/library/sounds/game.json
git commit -m "Add game seed sounds"
```

---

## Task 17: Compile the seed set into the library bundle

**Files:**
- Create: `scripts/build-library.mjs`
- Create: `src/library/sounds/generated.ts` (generated, but committed)
- Modify: `src/library/index.ts` (create if it doesn't exist yet)

**Interfaces:**
- Consumes: every `src/library/sounds/*.json` file from Tasks 11-16.
- Produces: `sounds: SoundEntry[]` exported from `src/library/index.ts`. `scripts/prose-probe.ts` (Task 18) and the web player (Task 20) both import `sounds` from here.

- [ ] **Step 1: Write the build script**

```js
#!/usr/bin/env node
// scripts/build-library.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const soundsDir = join(__dirname, '..', 'src', 'library', 'sounds');
const outputFile = join(soundsDir, 'generated.ts');

const files = readdirSync(soundsDir)
  .filter((file) => file.endsWith('.json'))
  .sort();

const entries = files.flatMap((file) => JSON.parse(readFileSync(join(soundsDir, file), 'utf8')));

const header = '// Generated by scripts/build-library.mjs from src/library/sounds/*.json. Do not edit by hand.\n';
const body = `import type { SoundEntry } from '../types';\n\nexport const sounds: SoundEntry[] = ${JSON.stringify(entries, null, 2)};\n`;

writeFileSync(outputFile, header + body);
console.log(`Wrote ${entries.length} entries from ${files.length} files to ${outputFile}`);
```

- [ ] **Step 2: Run it**

Run: `node scripts/build-library.mjs`
Expected: `Wrote 40 entries from 6 files to .../src/library/sounds/generated.ts`

- [ ] **Step 3: Run the full-library check**

Run: `node scripts/check-library.mjs`
Expected: `40 entries checked, 0 problems found.`
If any problems appear (for example, a duplicate name or phrase across
two different batches), fix the offending batch file, re-run Step 2,
and re-run this check before continuing.

- [ ] **Step 4: Write `src/library/index.ts`**

```ts
// src/library/index.ts
export * from './types';
export * from './normalize';
export * from './normalize-phrase';
export * from './query';
export * from './render';
export * from './validate';
export { sounds } from './sounds/generated';
```

- [ ] **Step 5: Write a smoke test**

```ts
// src/library/index.test.ts
import { describe, it, expect } from 'vitest';
import { sounds, createSoundIndex, searchIndex, checkLibrary } from './index';

describe('the compiled library', () => {
  it('has 40 entries and no validation problems', () => {
    expect(sounds.length).toBe(40);
    expect(checkLibrary(sounds).size).toBe(0);
  });

  it('is searchable', () => {
    const index = createSoundIndex(sounds);
    const results = searchIndex(index, 'success chime');
    expect(results[0]?.sound.name).toBe('success-chime');
  });
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- index.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add scripts/build-library.mjs src/library/sounds/generated.ts src/library/index.ts src/library/index.test.ts
git commit -m "Compile the 40-sound seed set into the library bundle"
```

---

## Task 18: Retrieval probe (`scripts/prose-probe.ts`)

**Files:**
- Create: `scripts/prose-probe.ts`

**Interfaces:**
- Consumes: `sounds`, `createSoundIndex`, `searchIndex`, `LOCAL_MIN_SCORE` from `../src/library/index`.
- Produces: a CLI report; Task 19 (threshold tuning) reads its pass/fail counts.

- [ ] **Step 1: Write the probe**

```ts
// scripts/prose-probe.ts
import { sounds, createSoundIndex, searchIndex, LOCAL_MIN_SCORE } from '../src/library/index';

type Case = { query: string; accept: string[] };

const CASES: Case[] = [
  // Everyday phrasing
  { query: 'the file finished uploading', accept: ['upload complete'] },
  { query: 'something went wrong', accept: ['error buzz'] },
  { query: 'nice, that worked', accept: ['success chime'] },
  { query: 'turn the setting on', accept: ['toggle on'] },
  { query: 'turn the setting off', accept: ['toggle off'] },
  { query: 'someone sent me a message', accept: ['message received'] },
  { query: 'my timer is done', accept: ['timer done'] },
  { query: 'wake up alarm going off', accept: ['alarm'] },
  { query: 'i just leveled up', accept: ['level up'] },
  { query: 'i picked up a coin', accept: ['coin pickup'] },
  { query: 'close this menu', accept: ['menu close'] },
  { query: 'open the menu', accept: ['menu open'] },
  { query: 'i pressed a key', accept: ['key press'] },
  { query: 'the game is over', accept: ['game over'] },
  { query: 'i got an extra life', accept: ['extra life'] },
  { query: 'delete this item', accept: ['delete'] },
  { query: 'unlocked a new achievement', accept: ['achievement unlocked'] },
  { query: 'switch to the other tab', accept: ['tab switch'] },
  { query: 'a light tap on a button', accept: ['tap'] },
  { query: 'someone mentioned me', accept: ['mention alert'] },

  // Word-traps: a rare or misleading token must not win alone
  { query: 'coin', accept: ['coin pickup', 'coin combo'] },
  { query: 'open', accept: ['menu open', 'modal open'] },
  { query: 'close', accept: ['menu close', 'modal close'] },

  // Honest gaps: the seed set has no answer for these
  { query: 'the smell of rain on hot pavement', accept: [] },
  { query: 'quantum entanglement', accept: [] },
  { query: 'a philosophical disagreement', accept: [] },
  { query: 'the taste of coffee', accept: [] },
];

const index = createSoundIndex(sounds);
const knownPhrases = new Set(sounds.map((s) => s.phrase));

for (const testCase of CASES) {
  for (const accepted of testCase.accept) {
    if (!knownPhrases.has(accepted)) {
      console.error(`Probe case "${testCase.query}" accepts unknown phrase "${accepted}"`);
      process.exit(1);
    }
  }
}

let passed = 0;
const failures: string[] = [];

for (const testCase of CASES) {
  const [top] = searchIndex(index, testCase.query, { limit: 1 });
  const answer = top && top.score >= LOCAL_MIN_SCORE ? top.sound.phrase : null;
  const wantsNothing = testCase.accept.length === 0;
  const ok = wantsNothing ? answer === null : answer !== null && testCase.accept.includes(answer);

  if (ok) {
    passed++;
  } else {
    failures.push(`"${testCase.query}" -> got ${answer ?? 'nothing'} (score ${top?.score.toFixed(1) ?? 'n/a'}), wanted one of [${testCase.accept.join(', ') || 'nothing'}]`);
  }
}

console.log(`${passed} of ${CASES.length} prose cases answered correctly at rank 1 (floor ${LOCAL_MIN_SCORE}).`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const failure of failures) console.log(`  ${failure}`);
}
process.exit(failures.length > 0 ? 1 : 0);
```

- [ ] **Step 2: Run it**

Run: `npm run probe`
Expected: prints a pass count. It is fine if not all 27 cases pass yet;
Task 19 tunes the floor to maximize this.

- [ ] **Step 3: Commit**

```bash
git add scripts/prose-probe.ts
git commit -m "Add labelled prose retrieval probe"
```

---

## Task 19: Tune the score floor

**Files:**
- Create: `scripts/tune-thresholds.ts`
- Modify: `src/library/query.ts:LOCAL_MIN_SCORE` (update the literal default)

**Interfaces:**
- Consumes: the same `CASES` array as Task 18 (import it by refactoring `scripts/prose-probe.ts` to export `CASES` and a `runProbe(floor)` function; both this task and Task 18's CLI use it).

- [ ] **Step 1: Refactor `scripts/prose-probe.ts` to export a reusable runner**

```ts
// scripts/prose-probe.ts (replace the bottom section, keep CASES and the
// unknown-phrase check as they are)
export function runProbe(floor: number): { passed: number; total: number; failures: string[] } {
  let passed = 0;
  const failures: string[] = [];
  for (const testCase of CASES) {
    const [top] = searchIndex(index, testCase.query, { limit: 1 });
    const answer = top && top.score >= floor ? top.sound.phrase : null;
    const wantsNothing = testCase.accept.length === 0;
    const ok = wantsNothing ? answer === null : answer !== null && testCase.accept.includes(answer);
    if (ok) {
      passed++;
    } else {
      failures.push(`"${testCase.query}" -> got ${answer ?? 'nothing'} (score ${top?.score.toFixed(1) ?? 'n/a'})`);
    }
  }
  return { passed, total: CASES.length, failures };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = runProbe(LOCAL_MIN_SCORE);
  console.log(`${result.passed} of ${result.total} prose cases answered correctly at rank 1 (floor ${LOCAL_MIN_SCORE}).`);
  if (result.failures.length > 0) {
    console.log('\nFailures:');
    for (const failure of result.failures) console.log(`  ${failure}`);
  }
  process.exit(result.failures.length > 0 ? 1 : 0);
}
```

- [ ] **Step 2: Write the grid search**

```ts
// scripts/tune-thresholds.ts
import { runProbe } from './prose-probe';

let best = { floor: 0, passed: -1 };
for (let floor = 10; floor <= 80; floor += 2) {
  const result = runProbe(floor);
  console.log(`floor ${floor}: ${result.passed}/${result.total}`);
  if (result.passed > best.passed) {
    best = { floor, passed: result.passed };
  }
}
console.log(`\nBest floor: ${best.floor} (${best.passed} passed)`);
```

- [ ] **Step 3: Run it**

Run: `node --import tsx scripts/tune-thresholds.ts`
Read the printed best floor.

- [ ] **Step 4: Apply the result**

Update the `LOCAL_MIN_SCORE` literal in `src/library/query.ts` to the
best floor found. Re-run `npm run probe` and confirm the pass count
matches what the grid search reported.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all tests still PASS (the query tests in Task 6 use example
fixtures, not the seed set, so they are unaffected by this constant
changing).

- [ ] **Step 6: Commit**

```bash
git add scripts/prose-probe.ts scripts/tune-thresholds.ts src/library/query.ts
git commit -m "Tune LOCAL_MIN_SCORE by grid search against the prose probe"
```

---

## Task 20: Web player

**Files:**
- Create: `web/index.html`
- Create: `web/main.ts`
- Create: `web/style.css`
- Create: `web/vite.config.ts`
- Modify: `package.json` (add a `"dev:web"` script)

**Interfaces:**
- Consumes: `sounds`, `createSoundIndex`, `searchIndex`, `renderPatch`, `RENDER_SAMPLE_RATE` from `../src/library/index`.

- [ ] **Step 1: Write `web/vite.config.ts`**

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  root: __dirname,
});
```

- [ ] **Step 2: Write `web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Semantic Sounds — dev player</title>
    <link rel="stylesheet" href="./style.css" />
  </head>
  <body>
    <main>
      <h1>Semantic Sounds</h1>
      <p>Type what you're looking for. Nothing plays until you click a result.</p>
      <input id="query" type="text" placeholder="e.g. the upload finished" autocomplete="off" />
      <div class="controls">
        <label><input id="mute" type="checkbox" /> Mute</label>
        <label>Volume <input id="volume" type="range" min="0" max="1" step="0.01" value="0.8" /></label>
      </div>
      <ul id="results"></ul>
    </main>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

- [ ] **Step 3: Write `web/style.css`**

```css
body {
  font-family: system-ui, sans-serif;
  max-width: 640px;
  margin: 2rem auto;
  padding: 0 1rem;
}
input[type='text'] {
  width: 100%;
  padding: 0.5rem;
  font-size: 1rem;
}
.controls {
  display: flex;
  gap: 1.5rem;
  margin: 0.75rem 0;
}
#results {
  list-style: none;
  padding: 0;
}
#results li {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid #ddd;
}
button.play {
  cursor: pointer;
}
```

- [ ] **Step 4: Write `web/main.ts`**

```ts
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
  buffer.copyToChannel(samples, 0);

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
```

- [ ] **Step 5: Add the dev script to `package.json`**

```json
"dev:web": "vite --config web/vite.config.ts"
```

- [ ] **Step 6: Verify it runs**

Run: `npm run dev:web`
Open the printed local URL. Type "the upload finished" and confirm
`upload complete` appears in the results. Click its play button and
confirm a sound plays. Stop the dev server (Ctrl+C) when done.

- [ ] **Step 7: Commit**

```bash
git add web package.json
git commit -m "Add minimal web player for local listening during development"
```

---

## Task 21: TODO.md and README

**Files:**
- Create: `TODO.md`
- Create: `README.md`

**Interfaces:**
- Consumes: section 13 of the spec (open follow-ups) and the final `LOCAL_MIN_SCORE`/probe pass count from Tasks 18-19.

- [ ] **Step 1: Write `TODO.md`**

```markdown
# TODO

Deferred work and decisions, with reasons. Update this file rather than
letting deferred work rot into an undocumented gap.

## Deferred to later sub-projects

- The review tool with play buttons (sub-project 2).
- The full 300-500 sound set, built by parallel agents from
  `docs/sound-batches/AGENT_BRIEF.md` at a larger scale (sub-project 3).
  A "must not regress" band should be added to `scripts/prose-probe.ts`
  once that set ships.
- The SDK, MCP server, and the `semantic-sounds-mcp` wrapper package
  (sub-project 4). `npm view semantic-sounds` and `npm view
  semantic-sounds-mcp` were both free on 2026-09-15.
- Generation for a miss, using `claude-opus-5` through structured
  outputs, checked by `checkEntry` (sub-project 5).
- The public static site (sub-project 6).

## Open technical follow-ups

- `LOCAL_MIN_SCORE` was grid-searched against a 27-case probe covering
  only the 40-sound seed set. Re-run `scripts/tune-thresholds.ts`
  whenever the corpus grows meaningfully; do not assume the value is
  stable at a larger scale.
- The shared tonal centre is a soft guideline in the style guide, not a
  validator rule. If sounds don't sit well back-to-back in practice,
  consider promoting it to a machine check, but only with evidence from
  actual listening.
- Filters are one-pole. Revisit if the soft style rules ever need a
  steeper slope than a one-pole filter can give.
- `MAX_LAYERS = 4` came from a performance check on a 1s/4-layer patch.
  Raise it only after re-running that check.
```

- [ ] **Step 2: Write `README.md`**

```markdown
# Semantic Sounds

A curated set of short UI sounds, found by plain prose. A sound is
data, not an audio file: each entry is a small JSON "patch" of
synthesis settings (oscillators, noise, envelopes, filters, pitch
sweeps), rendered in the page by one deterministic TypeScript renderer.

```ts
import { sounds, createSoundIndex, searchIndex, renderPatch } from 'semantic-sounds';

const index = createSoundIndex(sounds);
const [match] = searchIndex(index, 'the upload finished', { limit: 1 });
const samples = renderPatch(match.sound.patch); // Float32Array, 48kHz
```

See `docs/sound-style-guide.md` for the contract every sound follows,
and `docs/superpowers/specs/2026-09-15-sound-contract-and-renderer-design.md`
for the full design.

## Development

```bash
npm install
npm test
npm run build
npm run dev:web   # local player at the printed URL
npm run probe     # retrieval probe against labelled prose cases
```

## License

MIT © BirdTempo
```

- [ ] **Step 3: Commit**

```bash
git add TODO.md README.md
git commit -m "Add TODO and README"
```

---

## Task 22: Final verification

**Files:** none created; this task only runs checks.

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 3: Full library check**

Run: `node scripts/check-library.mjs`
Expected: `40 entries checked, 0 problems found.`

- [ ] **Step 4: Probe**

Run: `npm run probe`
Expected: prints the final pass count at the tuned floor. Note the
result in `TODO.md` if it is below 25 of 27 — that's a signal the
keyword data needs another pass, the same lesson the icon project
learned (the scorer usually isn't the bottleneck, the keywords are).

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: `dist/index.js` and `dist/index.d.ts` are produced with no
errors.

- [ ] **Step 6: Pack and smoke-test the built package**

```bash
npm pack
mkdir -p /tmp/semantic-sounds-smoke-test
tar -xzf semantic-sounds-*.tgz -C /tmp/semantic-sounds-smoke-test
node -e "
const { sounds, createSoundIndex, searchIndex, renderPatch } = require('/tmp/semantic-sounds-smoke-test/package/dist/index.js');
console.log(sounds.length, 'sounds loaded');
const index = createSoundIndex(sounds);
const [match] = searchIndex(index, 'the upload finished', { limit: 1 });
console.log('matched:', match.sound.phrase);
console.log('rendered', renderPatch(match.sound.patch).length, 'samples');
"
rm -f semantic-sounds-*.tgz
rm -rf /tmp/semantic-sounds-smoke-test
```

Expected: prints `40 sounds loaded`, `matched: upload complete`, and a
sample count > 0. If `require` fails because the build is ESM-only,
use `node --input-type=module -e "import(...)"` instead — confirm
which is needed and fix this step's exact command before relying on it
again.

- [ ] **Step 7: Commit any fixes found during verification**

If any step above required a code change, commit it with a message
describing what verification caught.
