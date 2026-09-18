import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeFixture, sampleEntry, type Fixture } from './fixture.js';
import { createSession, ReviewError, STOPPED_MESSAGE } from './session.js';
import { createStore } from './store.js';
import type { DrawRequest, DrawResult } from './types.js';

let fixture: Fixture | null = null;
afterEach(() => {
  fixture?.cleanup();
  fixture = null;
});

const entries = () => [sampleEntry({ name: 'one', phrase: 'one' }), sampleEntry({ name: 'two', phrase: 'two' })];

const okDraw = async (): Promise<DrawResult> => ({
  ok: true,
  candidate: {
    concept: 'A replacement sound written for this entry by the test.',
    patch: sampleEntry().patch,
    model: 'test-model',
  },
});

function setup(draw: ((request: DrawRequest) => Promise<DrawResult>) | null = okDraw) {
  fixture = makeFixture({ 'a-batch': entries() });
  const store = createStore(fixture.root);
  let counter = 0;
  const session = createSession({
    store,
    draw,
    now: () => new Date('2026-09-19T00:00:00.000Z'),
    newId: () => `id-${counter++}`,
  });
  return { store, session };
}

describe('reject', () => {
  it('records the rejection, opens a row, and starts three slots', async () => {
    const { store, session } = setup();
    const open = session.reject([{ name: 'one', reason: 'too harsh' }]);
    expect(open).toHaveLength(1);
    expect(open[0]!.slots).toHaveLength(3);
    const rejected = store.readRejected();
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ name: 'one', reason: 'too harsh', origin: 'library', round: 0 });
    await session.idle();
    expect(store.readSession().open[0]!.slots.every((slot) => slot.status === 'ready')).toBe(true);
  });

  it('refuses an unknown name, a repeat, and a row already open', () => {
    const { session } = setup();
    expect(() => session.reject([{ name: 'missing' }])).toThrow(ReviewError);
    expect(() => session.reject([{ name: 'one' }, { name: 'one' }])).toThrow(/twice/);
    session.reject([{ name: 'one' }]);
    expect(() => session.reject([{ name: 'one' }])).toThrow(/already in redraw/);
  });

  it('refuses an empty list and a reason that is not text', () => {
    const { session } = setup();
    expect(() => session.reject([])).toThrow(/at least one/);
    expect(() => session.reject([{ name: 'one', reason: 7 as unknown as string }])).toThrow(/not text/);
  });

  it('refuses to start without a generator', () => {
    const { session } = setup(null);
    expect(() => session.reject([{ name: 'one' }])).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('writes nothing when any item in the body is bad', () => {
    const { store, session } = setup();
    expect(() => session.reject([{ name: 'one' }, { name: 'missing' }])).toThrow(ReviewError);
    expect(store.readRejected()).toEqual([]);
    expect(store.readSession().open).toEqual([]);
  });
});

describe('decide', () => {
  it('accepts a slot into the library and closes the row', async () => {
    const { store, session } = setup();
    session.reject([{ name: 'one' }]);
    await session.idle();
    const result = session.decide([{ name: 'one', choice: 'A' }]);
    expect(result.accepted).toBe(1);
    expect(result.open).toEqual([]);
    const written = store.listEntries().find((entry) => entry.name === 'one');
    expect(written!.concept).toBe('A replacement sound written for this entry by the test.');
  });

  it('records the slots it did not accept as rejected, with their model', async () => {
    const { store, session } = setup();
    session.reject([{ name: 'one' }]);
    await session.idle();
    session.decide([{ name: 'one', choice: 'A', reason: 'B and C were dull' }]);
    const generated = store.readRejected().filter((line) => line.origin === 'generated');
    expect(generated).toHaveLength(2);
    expect(generated[0]).toMatchObject({ model: 'test-model', round: 1, reason: 'B and C were dull' });
  });

  it('starts a new round on "redraw" and keeps the row open', async () => {
    const { store, session } = setup();
    session.reject([{ name: 'one' }]);
    await session.idle();
    const result = session.decide([{ name: 'one', choice: 'redraw' }]);
    expect(result.accepted).toBe(0);
    expect(result.open[0]!.round).toBe(2);
    expect(store.readRejected().filter((line) => line.origin === 'generated')).toHaveLength(3);
    await session.idle();
  });

  it('closes the row on "keep" without touching the library', async () => {
    const { store, session } = setup();
    const before = store.listEntries().find((entry) => entry.name === 'one')!.concept;
    session.reject([{ name: 'one' }]);
    await session.idle();
    const result = session.decide([{ name: 'one', choice: 'keep' }]);
    expect(result.open).toEqual([]);
    expect(store.listEntries().find((entry) => entry.name === 'one')!.concept).toBe(before);
  });

  it('refuses a row that still has a slot in flight', () => {
    const { session } = setup(() => new Promise<DrawResult>(() => {}));
    session.reject([{ name: 'one' }]);
    expect(() => session.decide([{ name: 'one', choice: 'keep' }])).toThrow(/still/);
  });

  it('refuses an unknown choice, an unopened row, and a repeat', async () => {
    const { session } = setup();
    session.reject([{ name: 'one' }]);
    await session.idle();
    expect(() => session.decide([{ name: 'one', choice: 'Z' as never }])).toThrow(/not a choice/);
    expect(() => session.decide([{ name: 'two', choice: 'keep' }])).toThrow(/not in the open work/);
    expect(() => session.decide([{ name: 'one', choice: 'keep' }, { name: 'one', choice: 'keep' }])).toThrow(/twice/);
  });

  it('refuses a slot that failed', async () => {
    const { session } = setup(async () => ({ ok: false, error: 'no' }));
    session.reject([{ name: 'one' }]);
    await session.idle();
    expect(() => session.decide([{ name: 'one', choice: 'A' }])).toThrow(/has no sound/);
  });

  it('refuses an empty list', () => {
    const { session } = setup();
    expect(() => session.decide([])).toThrow(/at least one/);
  });
});

describe('recovery', () => {
  it('fails any slot left pending when the server stopped', () => {
    fixture = makeFixture({ 'a-batch': entries() });
    const store = createStore(fixture.root);
    store.writeSession({
      open: [{ name: 'one', round: 1, startedAt: 'then', slots: [{ id: 'x', status: 'pending' }] }],
    });
    const session = createSession({ store, draw: okDraw });
    expect(session.view()[0]!.slots[0]).toMatchObject({ status: 'failed', error: STOPPED_MESSAGE });
    expect(store.readSession().open[0]!.slots[0]!.status).toBe('failed');
  });
});

describe('view', () => {
  it('joins the open rows with their library entry', async () => {
    const { session } = setup();
    session.reject([{ name: 'one' }]);
    await session.idle();
    const row = session.view()[0]!;
    expect(row.phrase).toBe('one');
    expect(row.category).toBe('ui-feedback');
    expect(row.current.patch).not.toBeNull();
  });

  it('reports the open names', () => {
    const { session } = setup();
    session.reject([{ name: 'one' }]);
    expect(session.openNames()).toEqual(['one']);
  });
});

describe('onSlot', () => {
  it('publishes an event for each settled slot', async () => {
    fixture = makeFixture({ 'a-batch': entries() });
    const onSlot = vi.fn();
    const session = createSession({ store: createStore(fixture.root), draw: okDraw, onSlot });
    session.reject([{ name: 'one' }]);
    await session.idle();
    expect(onSlot).toHaveBeenCalledTimes(3);
    expect(onSlot.mock.calls[0]![0]).toMatchObject({ name: 'one', status: 'ready', round: 1 });
  });
});
