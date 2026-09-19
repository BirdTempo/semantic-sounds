import { describe, it, expect } from 'vitest';
import { transpose, stretch, amplify, tweak, isUntweaked, MAX_SEMITONES } from './transform';
import { patchDurationMs } from './render';
import { MIN_FREQ_HZ, MAX_FREQ_HZ, type Patch } from './types';

const TONE: Patch = {
  layers: [
    {
      source: { type: 'oscillator', wave: 'sine', freqHz: 440, pitchEnvelope: { toHz: 880, timeMs: 40 } },
      envelope: { attackMs: 4, decayMs: 40, sustainLevel: 0.4, sustainMs: 30, releaseMs: 60 },
      filter: { type: 'lowpass', cutoffHz: 2000 },
      gain: 0.6,
    },
  ],
};

const HISS: Patch = {
  layers: [
    {
      source: { type: 'noise', color: 'white' },
      envelope: { attackMs: 2, decayMs: 30, sustainLevel: 0.2, sustainMs: 10, releaseMs: 40 },
      gain: 0.5,
    },
  ],
};

const osc = (patch: Patch) => {
  const source = patch.layers[0]!.source;
  if (source.type !== 'oscillator') throw new Error('expected an oscillator');
  return source;
};

describe('transpose', () => {
  it('doubles the frequency at twelve semitones', () => {
    expect(osc(transpose(TONE, 12)).freqHz).toBeCloseTo(880, 6);
  });

  it('halves the frequency at minus twelve semitones', () => {
    expect(osc(transpose(TONE, -12)).freqHz).toBeCloseTo(220, 6);
  });

  it('moves the pitch envelope target with the tone', () => {
    expect(osc(transpose(TONE, 12)).pitchEnvelope?.toHz).toBeCloseTo(1760, 6);
  });

  it('moves the filter with the tone, so the timbre holds', () => {
    expect(transpose(TONE, 12).layers[0]?.filter?.cutoffHz).toBeCloseTo(4000, 6);
  });

  it('leaves the length alone', () => {
    expect(patchDurationMs(transpose(TONE, 7))).toBe(patchDurationMs(TONE));
  });

  it('leaves a noise layer alone, because a hiss has no key', () => {
    expect(transpose(HISS, 12)).toEqual(HISS);
  });

  it('returns the same patch for no change', () => {
    expect(transpose(TONE, 0)).toBe(TONE);
  });

  it('never changes the input', () => {
    const before = JSON.stringify(TONE);
    transpose(TONE, 5);
    expect(JSON.stringify(TONE)).toBe(before);
  });

  it('holds the frequency inside the contract range', () => {
    const up = transpose(TONE, MAX_SEMITONES);
    expect(osc(up).freqHz).toBeLessThanOrEqual(MAX_FREQ_HZ);
    const down = transpose({ layers: [{ ...TONE.layers[0]!, source: { type: 'oscillator', wave: 'sine', freqHz: 60 } }] }, -24);
    expect(osc(down).freqHz).toBeGreaterThanOrEqual(MIN_FREQ_HZ);
  });

  it('clamps a request beyond its own limits', () => {
    expect(transpose(TONE, 100)).toEqual(transpose(TONE, MAX_SEMITONES));
  });
});

describe('stretch', () => {
  it('doubles the length at a factor of two', () => {
    expect(patchDurationMs(stretch(TONE, 2))).toBeCloseTo(patchDurationMs(TONE) * 2, 6);
  });

  it('halves the length at a factor of one half', () => {
    expect(patchDurationMs(stretch(TONE, 0.5))).toBeCloseTo(patchDurationMs(TONE) / 2, 6);
  });

  it('leaves the pitch alone', () => {
    expect(osc(stretch(TONE, 2)).freqHz).toBe(440);
    expect(osc(stretch(TONE, 2)).pitchEnvelope?.toHz).toBe(880);
  });

  it('scales the pitch sweep with the rest, so it keeps its share', () => {
    const before = osc(TONE).pitchEnvelope!.timeMs / patchDurationMs(TONE);
    const after = osc(stretch(TONE, 2)).pitchEnvelope!.timeMs / patchDurationMs(stretch(TONE, 2));
    expect(after).toBeCloseTo(before, 6);
  });

  it('keeps the sustain level, which is a level and not a time', () => {
    expect(stretch(TONE, 2).layers[0]?.envelope.sustainLevel).toBe(0.4);
  });

  it('stretches a noise layer, which has an envelope even with no pitch', () => {
    expect(patchDurationMs(stretch(HISS, 2))).toBeCloseTo(patchDurationMs(HISS) * 2, 6);
  });

  it('returns the same patch for no change', () => {
    expect(stretch(TONE, 1)).toBe(TONE);
  });

  it('never changes the input', () => {
    const before = JSON.stringify(TONE);
    stretch(TONE, 3);
    expect(JSON.stringify(TONE)).toBe(before);
  });
});

describe('amplify', () => {
  it('scales the gain', () => {
    expect(amplify(TONE, 0.5).layers[0]?.gain).toBeCloseTo(0.3, 6);
  });

  it('holds the gain at one, so the ceiling never flattens the shape', () => {
    expect(amplify(TONE, 10).layers[0]?.gain).toBe(1);
  });
});

describe('tweak', () => {
  it('applies pitch and length together', () => {
    const out = tweak(TONE, { semitones: 12, stretch: 2 });
    expect(osc(out).freqHz).toBeCloseTo(880, 6);
    expect(patchDurationMs(out)).toBeCloseTo(patchDurationMs(TONE) * 2, 6);
  });

  it('is the identity for an empty request', () => {
    expect(tweak(TONE, {})).toBe(TONE);
  });

  it('knows when nothing would change', () => {
    expect(isUntweaked({})).toBe(true);
    expect(isUntweaked({ semitones: 0, stretch: 1 })).toBe(true);
    expect(isUntweaked({ semitones: 1 })).toBe(false);
    expect(isUntweaked({ stretch: 1.5 })).toBe(false);
  });
});
