import { describe, expect, it } from 'vitest';
import { CandidateSchema, findApiKey, normalizePatch } from './anthropic.js';

describe('CandidateSchema', () => {
  it('accepts a patch whose optional fields are null', () => {
    const parsed = CandidateSchema.parse({
      concept: 'A short soft tap.',
      patch: {
        layers: [
          {
            source: { type: 'oscillator', wave: 'sine', freqHz: 600, pitchEnvelope: null },
            envelope: { attackMs: 2, decayMs: 20, sustainLevel: 0, sustainMs: 0, releaseMs: 15 },
            filter: null,
            gain: 0.6,
          },
        ],
      },
    });
    expect(parsed.patch.layers).toHaveLength(1);
  });

  it('accepts a noise layer and a filter', () => {
    const parsed = CandidateSchema.parse({
      concept: 'A soft noise whoosh.',
      patch: {
        layers: [
          {
            source: { type: 'noise', color: 'pink' },
            envelope: { attackMs: 5, decayMs: 30, sustainLevel: 0.2, sustainMs: 20, releaseMs: 40 },
            filter: { type: 'lowpass', cutoffHz: 900, q: null },
            gain: 0.4,
          },
        ],
      },
    });
    expect(parsed.patch.layers[0]!.source.type).toBe('noise');
  });

  it('rejects a patch with no layers', () => {
    expect(() => CandidateSchema.parse({ concept: 'x', patch: { layers: [] } })).toThrow();
  });

  it('rejects a patch with more than four layers', () => {
    const layer = {
      source: { type: 'noise', color: 'white' },
      envelope: { attackMs: 5, decayMs: 30, sustainLevel: 0.2, sustainMs: 20, releaseMs: 40 },
      filter: null,
      gain: 0.4,
    };
    expect(() => CandidateSchema.parse({ concept: 'x', patch: { layers: Array(5).fill(layer) } })).toThrow();
  });
});

describe('normalizePatch', () => {
  it('drops null optional fields so the result matches the library Patch type', () => {
    const patch = normalizePatch({
      layers: [
        {
          source: { type: 'oscillator', wave: 'sine', freqHz: 600, pitchEnvelope: null },
          envelope: { attackMs: 2, decayMs: 20, sustainLevel: 0, sustainMs: 0, releaseMs: 15 },
          filter: null,
          gain: 0.6,
        },
      ],
    });
    const layer = patch.layers[0]!;
    expect('filter' in layer).toBe(false);
    expect('pitchEnvelope' in layer.source).toBe(false);
  });

  it('keeps the values that are present', () => {
    const patch = normalizePatch({
      layers: [
        {
          source: { type: 'oscillator', wave: 'saw', freqHz: 300, pitchEnvelope: { toHz: 900, timeMs: 80 } },
          envelope: { attackMs: 4, decayMs: 20, sustainLevel: 0.3, sustainMs: 10, releaseMs: 20 },
          filter: { type: 'lowpass', cutoffHz: 2000, q: 0.8 },
          gain: 0.5,
        },
      ],
    });
    const layer = patch.layers[0]!;
    expect(layer.filter).toEqual({ type: 'lowpass', cutoffHz: 2000, q: 0.8 });
    expect(layer.source).toMatchObject({ pitchEnvelope: { toHz: 900, timeMs: 80 } });
  });

  it('drops a null q but keeps the filter', () => {
    const patch = normalizePatch({
      layers: [
        {
          source: { type: 'noise', color: 'white' },
          envelope: { attackMs: 4, decayMs: 20, sustainLevel: 0.3, sustainMs: 10, releaseMs: 20 },
          filter: { type: 'highpass', cutoffHz: 1200, q: null },
          gain: 0.5,
        },
      ],
    });
    expect(patch.layers[0]!.filter).toEqual({ type: 'highpass', cutoffHz: 1200 });
  });
});

describe('findApiKey', () => {
  it('prefers the environment', () => {
    expect(findApiKey({ ANTHROPIC_API_KEY: 'from-env' }, 'ANTHROPIC_API_KEY=from-file')).toBe('from-env');
  });

  it('falls back to the .env text, with quotes stripped', () => {
    expect(findApiKey({}, 'ANTHROPIC_API_KEY="from-file"')).toBe('from-file');
  });

  it('returns null when neither has a key', () => {
    expect(findApiKey({}, null)).toBeNull();
    expect(findApiKey({ ANTHROPIC_API_KEY: '  ' }, 'OTHER=1')).toBeNull();
  });
});
