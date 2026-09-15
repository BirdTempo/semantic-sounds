import { describe, it, expect } from 'vitest';
import type { SoundEntry } from './types';
import { RENDER_SAMPLE_RATE, MAX_LAYERS } from './types';

describe('types', () => {
  it('accepts a well-formed SoundEntry', () => {
    const entry: SoundEntry = {
      name: 'tap',
      phrase: 'tap',
      category: 'ui-feedback',
      concept: 'A single sharp click for a light UI tap.',
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
