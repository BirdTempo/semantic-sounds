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
    patch: {
      layers: [
        {
          source: { type: 'oscillator', wave: 'sine', freqHz: 440 },
          envelope: { attackMs: 2, decayMs: 10, sustainLevel: 0, sustainMs: 0, releaseMs: 10 },
          gain: 0.5,
        },
      ],
    },
    ...overrides,
  };
}

describe('searchIndex', () => {
  let index: SoundIndex;

  beforeAll(() => {
    const entries: SoundEntry[] = [
      entry({
        name: 'success-chime',
        phrase: 'success chime',
        category: 'ui-feedback',
        concept: 'A short rising chime for a completed action.',
        keywords: ['success', 'done', 'complete', 'confirm', 'checkmark'],
      }),
      entry({
        name: 'error-buzz',
        phrase: 'error buzz',
        category: 'ui-feedback',
        concept: 'A short low buzz for a failed action.',
        keywords: ['error', 'fail', 'wrong', 'invalid', 'buzz'],
      }),
      entry({
        name: 'kettle-whistle',
        phrase: 'kettle whistle',
        category: 'game',
        concept: 'A rising whistle like a kettle coming to a boil.',
        keywords: ['kettle', 'whistle', 'tea', 'boil', 'steam'],
      }),
      entry({
        name: 'cup-of-tea',
        phrase: 'cup of tea',
        category: 'game',
        concept: 'A gentle clink for pouring a cup of tea, using a kettle.',
        keywords: ['tea', 'cup', 'drink', 'kettle', 'clink'],
      }),
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
