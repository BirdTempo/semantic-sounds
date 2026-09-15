import { describe, it, expect } from 'vitest';
import { checkEntry, checkLibrary, computeDescriptors } from './validate';
import { renderPatch } from './render';
import type { SoundEntry } from './types';

function validEntry(overrides: Partial<SoundEntry> = {}): SoundEntry {
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
