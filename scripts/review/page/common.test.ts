import { describe, expect, it } from 'vitest';
import { mergeSlots, redrawCounts } from './common.js';

const row = (name: string, statuses: string[]) => ({
  name,
  slots: statuses.map((status, index) => ({ id: `${name}-${index}`, status })),
});

describe('redrawCounts', () => {
  it('does not count a row that still has a pending slot', () => {
    const rows = [row('a', ['pending', 'ready', 'ready']), row('b', ['ready', 'ready', 'ready'])];
    const counts = redrawCounts(rows, new Map());
    expect(counts.ready).toBe(1);
    expect(counts.redraw).toBe(1);
  });

  it('counts each choice, defaulting to redraw', () => {
    const rows = [
      row('a', ['ready', 'ready', 'ready']),
      row('b', ['ready', 'ready', 'ready']),
      row('c', ['ready', 'ready', 'ready']),
    ];
    const choices = new Map([
      ['a', { choice: 'A' }],
      ['b', { choice: 'keep' }],
    ]);
    expect(redrawCounts(rows, choices)).toEqual({ accept: 1, keep: 1, redraw: 1, ready: 3 });
  });
});

describe('mergeSlots', () => {
  it('keeps a settled slot when the fetch still calls it pending', () => {
    const previous = [row('a', ['ready', 'pending', 'pending'])];
    const next = [row('a', ['pending', 'pending', 'pending'])];
    expect(mergeSlots(next, previous)[0]!.slots[0]!.status).toBe('ready');
  });

  it('takes the server slot when the page has nothing newer', () => {
    const previous = [row('a', ['pending', 'pending', 'pending'])];
    const next = [row('a', ['ready', 'pending', 'pending'])];
    expect(mergeSlots(next, previous)[0]!.slots[0]!.status).toBe('ready');
  });
});
