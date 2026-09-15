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
