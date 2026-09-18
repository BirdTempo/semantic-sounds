import { describe, it, expect } from 'vitest';
import { sounds, createSoundIndex, searchIndex, checkLibrary } from './index';

describe('the compiled library', () => {
  // The set grows. The floor is the promise: at least 1000 sounds, every
  // one of them inside the contract, with no duplicate name or phrase.
  it('holds at least 1000 entries and no validation problems', () => {
    expect(sounds.length).toBeGreaterThanOrEqual(1000);
    expect(checkLibrary(sounds).size).toBe(0);
  });

  it('is searchable', () => {
    const index = createSoundIndex(sounds);
    const results = searchIndex(index, 'success chime');
    expect(results[0]?.sound.name).toBe('success-chime');
  });
});
