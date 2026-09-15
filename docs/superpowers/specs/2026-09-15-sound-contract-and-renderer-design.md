# Sub-project 1: contract, renderer, validator, seed set, prose search, web player

Status: approved for planning
Date: 2026-09-15
Author: Andrew Carmer (BirdTempo), with Claude Sonnet 5

## 1. Goal

Build the foundation of Semantic Sounds: a curated set of short UI sounds,
found by plain prose, where each sound is a small JSON patch, not an audio
file. This sub-project delivers:

- A patch schema and a deterministic TypeScript renderer.
- A sound contract and a validator that checks it.
- A seed set of 40 sounds across the full taxonomy.
- A prose search engine, adapted from Semantic Icons.
- A retrieval probe with labelled prose cases.
- A minimal web player for local listening during development.

Later sub-projects (not part of this spec): the review tool with play
buttons (sub-project 2), the full 300-500 sound set built by parallel
agents (sub-project 3), the SDK and MCP server (sub-project 4), model
generation for a miss (sub-project 5), and the public static site
(sub-project 6).

## 2. Reference project

`semantic-icons` (`/Users/admin/Documents/code/semantic-icons`) is the model
for this project. This spec reuses its patterns directly:

- The lexical prose query engine (`src/library/query.ts`, `normalize.ts`,
  `normalize-phrase.ts`): stemmer, stopwords, scored keywords, coverage
  curve, exact/contained-phrase bonuses, a single tunable score floor.
- The entry/validate/render split (`src/library/types.ts`, `validate.ts`,
  `render.ts`).
- The style guide as the load-bearing consistency document
  (`docs/icon-style-guide.md`).
- The labelled retrieval probe (`scripts/prose-probe.ts`), banded into
  regression / everyday phrasing / word-traps / honest gaps.
- The package/build layout: `tsup` with named subpath exports, strict
  `tsconfig.json` with `noUncheckedIndexedAccess`.

Code is copied and adapted, not shared as a package yet.

## 3. Decisions carried in from brainstorming

- **Sonic style:** soft and rounded synth. Sine/triangle tones, gentle
  attacks, gentle low-pass filtering. Warm and unobtrusive, in the
  register of macOS/iOS system sounds. This is the sound-side equivalent
  of the icon set's "one strict visual style."
- **Seed coverage:** the 40 seed sounds spread across all six taxonomy
  buckets (about 6-7 each), not narrowed to one bucket. This stress-tests
  prose search across the intended vocabulary early.
- **Tonal centre:** a soft guideline in the style guide, not a
  validator-enforced rule. Authors aim for one register/scale by ear; the
  validator does not reject a patch for pitch choice.
- **Patch schema:** a fixed, closed layer list (Approach A below), not a
  generic modular graph. This keeps the validator exhaustive and keeps a
  narrow target for later model generation.
- **Package name:** `semantic-sounds` (library) and `semantic-sounds-mcp`
  (MCP wrapper, phase 4). Both confirmed free on the npm registry on
  2026-09-15.
- **License:** MIT. **Author field:** BirdTempo (not Andrew Carmer).

## 4. Entry shape and patch schema

```ts
type SoundEntry = {
  name: string;         // unique kebab-case id, stable across releases
  phrase: string;        // canonical phrase, e.g. "success chime"
  category: string;       // one of the six taxonomy buckets
  concept: string;        // 1-2 sentences; must agree with computed descriptors
  keywords: string[];      // prose search terms, same discipline as icons
  patch: Patch;
};

type Patch = {
  layers: Layer[];       // 1 to MAX_LAYERS (4)
};

type Layer = {
  source: OscillatorSource | NoiseSource;
  envelope: Envelope;
  filter?: Filter;
  gain: number;         // 0-1, this layer's mix level before the master stage
};

type OscillatorSource = {
  type: 'oscillator';
  wave: 'sine' | 'triangle' | 'square' | 'saw';
  freqHz: number;        // bounded, e.g. 40-8000
  pitchEnvelope?: {
    toHz: number;
    timeMs: number;       // linear or exponential sweep, renderer's choice
  };
};

type NoiseSource = {
  type: 'noise';
  color: 'white' | 'pink';
};

type Envelope = {
  attackMs: number;
  decayMs: number;
  sustainLevel: number;    // 0-1
  releaseMs: number;
};

type Filter = {
  type: 'lowpass' | 'highpass' | 'bandpass';
  cutoffHz: number;
  q?: number;          // resonance, bounded and optional
};
```

Every numeric field is bounded (min/max), and every string field is a
closed enum. This is the same whitelist discipline as `checkSvg`'s
tag/attribute list: the validator can check the whole schema field by
field, and a model (phase 5) has a narrow, reliable target to fill in.

`MAX_LAYERS = 4` is chosen from the renderer performance check in
section 5, not from a musical judgment. Raise it only after re-running
that check.

## 5. Renderer

One renderer, in TypeScript, is the source of truth. It takes a `Patch`
and a sample rate, and returns a `Float32Array`, sample by sample, with
the same result every time for the same input. Both the Node validator
and the browser player call this one function; nothing else produces
audio.

- **Sample rate:** the renderer always renders at a fixed internal
  `RENDER_SAMPLE_RATE = 48000`. The browser wraps the result in an
  `AudioBuffer` created at that same rate; `AudioBufferSourceNode`
  resamples to the `AudioContext`'s actual rate on playback. This means
  Node and the browser always render identical samples — no separate
  code path, no drift.
- **Performance budget:** render a 1 s, 4-layer sound in under 5 ms.
  Confirmed by a throwaway benchmark during brainstorming: a naive
  per-sample loop (`Math.sin`, `Math.exp`, `Math.random` called every
  sample) took ~10 ms, over budget. Three changes brought it to ~2.5 ms
  median:
  1. A wavetable sine lookup (2048-point table, linear interpolation)
     instead of calling `Math.sin` every sample.
  2. A recurrence-based envelope: compute the per-sample decay factor
     once (`Math.exp(-rate / sampleRate)`), then multiply forward,
     instead of calling `Math.exp` every sample.
  3. A fast xorshift PRNG for noise layers instead of `Math.random`.

  The renderer implementation must use these three techniques from the
  start; do not implement the naive version first and optimize later,
  since the naive version breaks the budget.
- **Mixing:** layers are summed after their own envelope and filter are
  applied, each scaled by its `gain`. A master stage then applies the
  contract's fade-in/fade-out (2-3 ms at each end, to avoid a click) and
  a final peak check.
- **Filters:** a one-pole implementation is enough for lowpass/highpass
  at this stage (as used in the benchmark); revisit only if the style
  guide's soft rules demand steeper slopes.

## 6. Sound contract

Written as `docs/sound-style-guide.md`, mirroring the structure of
`docs/icon-style-guide.md`: a technical contract, hard rules the
validator enforces, soft rules for human/agent judgment, the entry JSON
schema and a worked example, and a keyword-writing section tied directly
to the query engine's stemmer and stopword rules.

Hard, validator-enforced rules:

| Rule | Threshold |
|---|---|
| Duration | 30 ms to 1.5 s |
| Layers | 1 to 4 |
| Peak | at or below -1 dBFS, never clips |
| Loudness | RMS lands in a fixed target window (e.g. -20 to -14 dBFS) |
| DC offset | mean sample magnitude below a small epsilon (e.g. 0.001) |
| Start/end click | forced 2-3 ms fade at both ends |
| Sample rate | rendered at the fixed internal 48 kHz |
| Metadata | name/category kebab-case, concept at least 20 characters, at least 4 keywords, no duplicate name or phrase across the library |

Soft rules (style guide only, not machine-checked):

- Soft and rounded attack character, in keeping with the chosen sonic
  style.
- A shared register/scale as a guideline, by ear.
- Per-layer purpose: a tone layer carries pitch identity; a noise layer
  carries texture or a transient.

## 7. Validator

`checkEntry`/`checkLibrary`, mirroring `validate.ts`:

- **Metadata rules:** the table above, checked without rendering.
- **Contract rules:** render the patch once, then check duration, peak,
  loudness window, DC offset, and the start/end fade, against the
  thresholds above. Report every problem found, never stop at the
  first, matching the icon validator's discipline (an unparsed or
  out-of-range value is a reported problem, never a silent pass).
- **Descriptor computation:** the validator also computes plain
  descriptors a model cannot hear for itself:
  - **Duration:** sample count over the render sample rate.
  - **Brightness:** spectral centroid, from an FFT of the rendered
    buffer.
  - **Pitch direction:** compare a dominant-frequency estimate (e.g.
    autocorrelation or zero-crossing rate) in the first third of the
    sound against the last third; classify as rising, falling, or
    steady.
  - **Attack:** time from start to peak amplitude, as a fraction of
    total duration; classify as soft or sharp against a threshold.
- **Concept agreement check:** a small controlled vocabulary maps
  words in `concept` to a descriptor claim (`rising`/`ascending` to
  pitch direction rising, `soft`/`gentle` to attack soft, `sharp`/
  `percussive` to attack sharp, `bright` to brightness above a
  threshold, `dark`/`warm` to brightness below it, `short`/`quick` to
  duration below a threshold, `long`/`sustained` to duration above
  it). If `concept` uses one of these words and the computed descriptor
  disagrees, the validator reports a problem. This is the sound
  equivalent of the icon rule that a model's stated intent must match
  what the checker actually measures.
- **Cross-entry checks:** duplicate `name`, duplicate `phrase` (via the
  same phrase-normalization function used for query indexing, so the
  uniqueness check and the search index agree on what counts as the
  same phrase).

Returns every problem found, not just the first, exactly as
`checkLibrary` does today.

## 8. Prose search

Copy `query.ts`, `normalize.ts`, and `normalize-phrase.ts` from
`semantic-icons`, adapted so the indexed entry is `SoundEntry` (`patch`
instead of `svg`, otherwise the same fields). Keep the scoring
architecture as-is: term/rarity weighting, the coverage curve, exact and
contained phrase/keyword bonuses, and a single tunable
`LOCAL_MIN_SCORE` floor.

Do not assume the icon set's floor of 38, or its exact weight constants,
carry over unchanged. Re-derive them by grid search once the seed set
and the probe (section 9) both exist, the same way the icon set's
floor was chosen: below the floor, "should answer nothing" cases start
answering wrongly; above it, correct answers get refused.

The stopword list needs the same content-word judgment calls the icon
set made (keeping `up down in out on off` because they are meaningful,
not noise). For sounds, expect the same issue with words like `on`/
`off` if entries such as `toggle-on`/`toggle-off` exist, and with
register words like `low`/`high` if used for pitch.

## 9. Seed set and retrieval probe

**Seed set:** 40 entries, roughly 6-7 from each of the six taxonomy
buckets from the top-level brief:

1. UI feedback (success, error, warning, tap, toggle on/off, copy,
   undo, delete)
2. Messages and notifications
3. Progress (upload done, level up, coin, achievement)
4. Transitions (open, close, swipe)
5. Typing, timers, and alarms
6. A small game set

Each entry is authored as its own JSON file under
`src/library/sounds/*.json` (source of truth from day one, matching the
pattern sub-project 3 will scale up, even though the batch-build
tooling itself is out of scope here).

**Retrieval probe:** `scripts/prose-probe.ts`, built alongside the seed
set, banded like the icon probe:

- Everyday phrasing: natural requests a caller would actually type
  ("the file finished uploading", "something went wrong").
- Word-traps: a rare or misleading token that must not win alone.
- Honest gaps: prompts that should return nothing, because no sound in
  the seed set answers them.

Skip the "must not regress" band for now; nothing has shipped yet to
regress against. Add it once sub-project 3 ships the full set.

The probe validates up front that every `accept` phrase in its cases
actually exists in the library, failing fast if not, exactly as the
icon probe does.

## 10. Web player

A minimal local page under `web/`: plain HTML and TypeScript via Vite,
no framework. A search box calls the query
engine in-page; each result has a play button that renders its patch
and plays it through an `AudioBufferSourceNode`. A global mute toggle
and a volume slider are always present. No sound plays on page load;
the first sound plays only after a user gesture (a click), per the
`AudioContext` autoplay rule.

This is a development tool, not the public site. The public static
site is phase 6 and is a separate, later spec.

## 11. Package and file layout

```
docs/
  sound-style-guide.md
  superpowers/specs/2026-09-15-sound-contract-and-renderer-design.md
src/
  library/
    types.ts
    normalize.ts
    normalize-phrase.ts
    query.ts
    validate.ts
    render.ts
    index.ts
    sounds/*.json
scripts/
  prose-probe.ts
web/
  (minimal Vite dev player)
```

Root `package.json`:

- `"name": "semantic-sounds"`
- `"license": "MIT"`, `"author": "BirdTempo"`
- `"type": "module"`, `"engines": { "node": ">=18" }`
- One `tsup` entry for now: `src/library/index.ts` built to the `.`
  export (and a `./library` alias if useful). Further subpath exports
  (`./sdk`, `./mcp`, `./mcp/stdio`) are added in sub-project 4, not now.

`tsconfig.json` mirrors the icon project's strict settings, including
`noUncheckedIndexedAccess: true`.

## 12. Testing strategy

Test-driven development throughout, using Vitest, mirroring the icon
project's test layout (colocated `*.test.ts` files):

- **Stemmer/normalize:** unit tests against known word pairs, adapted
  from the icon set's cases plus sound-specific vocabulary.
- **Query/scoring:** unit tests for ranking behavior (exact phrase
  wins, coverage curve, contained-phrase bonus), independent of the
  actual seed content.
- **Validator:** unit tests per contract rule (duration, peak,
  loudness, DC offset, fade, layer count, concept agreement), each with
  a patch constructed to pass and one constructed to fail.
- **Renderer:** a determinism test (same patch renders to
  byte-identical output twice) and a performance test (render time
  under budget, checked as a median over repeated runs to avoid
  flakiness from a single slow tick).
- **Prose probe:** run as its own script (`scripts/prose-probe.ts`),
  not inside Vitest, exactly as in the icon project, reported as "N of
  M cases answered correctly at rank 1 (floor F)."

## 13. Open follow-ups (seed for this project's TODO.md)

- Re-derive `LOCAL_MIN_SCORE` and scoring weights by grid search once
  the seed set and probe exist; do not assume the icon set's values.
- Revisit `MAX_LAYERS = 4` only if a future sound genuinely needs more
  and the performance budget still holds.
- The shared tonal centre is a soft guideline for now. If sounds from
  the seed set do not sit well back-to-back in practice, consider
  promoting a machine check later, but only with evidence from
  listening, not by default.
- Filters are one-pole for now. Revisit if the soft style rules need a
  steeper slope than a one-pole filter can give.
