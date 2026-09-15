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
