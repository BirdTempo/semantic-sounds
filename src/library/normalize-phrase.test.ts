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
