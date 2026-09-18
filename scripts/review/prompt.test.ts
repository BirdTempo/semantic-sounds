import { describe, expect, it } from 'vitest';
import { sampleEntry } from './fixture.js';
import { buildRetryMessage, buildSystemPrompt, buildUserMessage, pickReferences, SLOT_HINTS } from './prompt.js';
import type { RejectedLine } from './types.js';

const rejected = (overrides: Partial<RejectedLine> = {}): RejectedLine => ({
  id: 'id',
  name: 'tap',
  phrase: 'tap',
  category: 'ui-feedback',
  concept: 'A rejected idea.',
  patch: sampleEntry().patch,
  reason: 'too harsh',
  origin: 'generated',
  model: 'claude-opus-5',
  round: 1,
  rejectedAt: '2026-09-19T00:00:00.000Z',
  ...overrides,
});

describe('buildSystemPrompt', () => {
  it('carries the style guide and names both output fields', () => {
    const prompt = buildSystemPrompt('RULE: keep it soft.');
    expect(prompt).toContain('RULE: keep it soft.');
    expect(prompt).toContain('concept');
    expect(prompt).toContain('patch');
  });
});

describe('pickReferences', () => {
  it('prefers the same category, excludes the target, and caps at 8', () => {
    const target = sampleEntry({ name: 'target', category: 'ui-feedback' });
    const library = [
      target,
      ...Array.from({ length: 6 }, (_, i) => sampleEntry({ name: `same-${i}`, category: 'ui-feedback' })),
      ...Array.from({ length: 6 }, (_, i) => sampleEntry({ name: `other-${i}`, category: 'game' })),
    ];
    const picked = pickReferences(target, library);
    expect(picked).toHaveLength(8);
    expect(picked.some((entry) => entry.name === 'target')).toBe(false);
    expect(picked.slice(0, 6).every((entry) => entry.category === 'ui-feedback')).toBe(true);
  });
});

describe('buildUserMessage', () => {
  const target = sampleEntry({ name: 'tap', phrase: 'tap', concept: 'The current idea that was rejected.' });

  it('withholds the current concept so the model is not anchored to it', () => {
    const message = buildUserMessage({ target, references: [], rejected: [], slot: 'A' });
    expect(message).not.toContain('The current idea that was rejected.');
    expect(message).toContain('tap');
  });

  it('lists rejected candidates newest first and caps them at 9', () => {
    const lines = Array.from({ length: 12 }, (_, i) =>
      rejected({
        id: `id-${i}`,
        concept: `idea ${i}`,
        rejectedAt: `2026-09-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
      }),
    );
    const message = buildUserMessage({ target, references: [], rejected: lines, slot: 'A' });
    expect(message).toContain('idea 11');
    expect(message).not.toContain('idea 0<');
  });

  it('ignores rejected lines that belong to another phrase', () => {
    const message = buildUserMessage({
      target,
      references: [],
      rejected: [rejected({ name: 'other', concept: 'not for this phrase' })],
      slot: 'A',
    });
    expect(message).not.toContain('not for this phrase');
  });

  it('writes "no reason given" when the reviewer left the reason empty', () => {
    const message = buildUserMessage({ target, references: [], rejected: [rejected({ reason: '  ' })], slot: 'A' });
    expect(message).toContain('no reason given');
  });

  it('varies the direction by slot', () => {
    const a = buildUserMessage({ target, references: [], rejected: [], slot: 'A' });
    const c = buildUserMessage({ target, references: [], rejected: [], slot: 'C' });
    expect(a).toContain(SLOT_HINTS.A);
    expect(c).toContain(SLOT_HINTS.C);
    expect(a).not.toBe(c);
  });

  it('includes a reference sound with its patch', () => {
    const reference = sampleEntry({ name: 'other', phrase: 'other sound' });
    const message = buildUserMessage({ target, references: [reference], rejected: [], slot: 'B' });
    expect(message).toContain('other sound');
    expect(message).toContain('"freqHz":600');
  });
});

describe('buildRetryMessage', () => {
  it('repeats the first message and lists every problem', () => {
    const message = buildRetryMessage('FIRST', { concept: 'idea', patch: sampleEntry().patch }, [
      'too loud',
      'too long',
    ]);
    expect(message).toContain('FIRST');
    expect(message).toContain('- too loud');
    expect(message).toContain('- too long');
  });
});
