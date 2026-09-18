// The review state rules: reject, slot result, decide, restart. No HTTP and
// no timers. Every file write happens inside a synchronous block, so two
// requests in this one Node process can never interleave their writes.
import { randomUUID } from 'node:crypto';
import type { SoundEntry } from '../../src/library/types.js';
import { checkEntry } from '../../src/library/validate.js';
import type { Store } from './store.js';
import {
  SLOT_LABELS,
  type Choice,
  type DrawRequest,
  type DrawResult,
  type OpenItem,
  type OpenView,
  type RejectedLine,
  type Slot,
  type SlotEvent,
  type SlotLabel,
} from './types.js';

export class ReviewError extends Error {
  constructor(
    readonly status: 400 | 409 | 503,
    message: string,
  ) {
    super(message);
    this.name = 'ReviewError';
  }
}

export const NO_KEY_MESSAGE =
  'no ANTHROPIC_API_KEY: set it in the environment or in .env at the repository root, then restart the server';
export const STOPPED_MESSAGE = 'the server stopped before this sound arrived';

export type SessionDeps = {
  store: Store;
  /** Null when no API key is set. Then no generation can start. */
  draw: ((request: DrawRequest) => Promise<DrawResult>) | null;
  onSlot?: (event: SlotEvent) => void;
  now?: () => Date;
  newId?: () => string;
};

export type RejectItem = { name: string; reason?: string };
export type DecideRow = { name: string; choice: Choice; reason?: string };

export type Session = {
  view(): OpenView[];
  openNames(): string[];
  reject(items: RejectItem[]): OpenView[];
  decide(rows: DecideRow[]): { open: OpenView[]; accepted: number };
  /** Resolves when every generation in flight has settled. */
  idle(): Promise<void>;
};

const CHOICES: readonly string[] = ['A', 'B', 'C', 'redraw', 'keep'];

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function createSession(deps: SessionDeps): Session {
  const { store } = deps;
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? randomUUID;
  const inFlight = new Set<Promise<void>>();

  // A generation that was in flight when the server stopped never arrives.
  const state = store.readSession();
  let recovered = false;
  for (const item of state.open) {
    for (const slot of item.slots) {
      if (slot.status !== 'pending') continue;
      slot.status = 'failed';
      slot.error = STOPPED_MESSAGE;
      recovered = true;
    }
  }
  if (recovered) store.writeSession(state);

  const entriesByName = (): Map<string, SoundEntry> => new Map(store.listEntries().map((e) => [e.name, e]));
  const freshSlots = (): Slot[] => SLOT_LABELS.map(() => ({ id: newId(), status: 'pending' }));
  const find = (name: string): OpenItem | undefined => state.open.find((item) => item.name === name);
  const reasonOf = (value: unknown, name: string): string => {
    if (value === undefined) return '';
    if (typeof value !== 'string') throw new ReviewError(400, `the reason for "${name}" is not text`);
    return value.trim();
  };

  const view = (): OpenView[] => {
    const entries = entriesByName();
    return state.open.map((item) => {
      const entry = entries.get(item.name);
      return {
        ...structuredClone(item),
        phrase: entry?.phrase ?? item.name,
        category: entry?.category ?? '',
        current: { concept: entry?.concept ?? '', patch: entry?.patch ?? null },
      };
    });
  };

  const settle = (name: string, slotId: string, result: DrawResult): void => {
    const item = find(name);
    const index = item ? item.slots.findIndex((slot) => slot.id === slotId) : -1;
    // The row closed, or moved to a new round, while this generation was in flight.
    if (!item || index === -1) return;
    const slot: Slot = result.ok
      ? { id: slotId, status: 'ready', ...result.candidate }
      : { id: slotId, status: 'failed', error: result.error };
    item.slots[index] = slot;
    store.writeSession(state);
    deps.onSlot?.({
      name,
      round: item.round,
      slot: SLOT_LABELS[index]!,
      id: slotId,
      status: slot.status,
      concept: slot.concept,
      patch: slot.patch,
      error: slot.error,
    });
  };

  const startDrawings = (item: OpenItem, entry: SoundEntry, draw: NonNullable<SessionDeps['draw']>): void => {
    const rejected = store.readRejected().filter((line) => line.name === entry.name);
    item.slots.forEach((slot, index) => {
      const job = draw({ entry, slot: SLOT_LABELS[index]!, rejected })
        .catch((error: unknown): DrawResult => ({ ok: false, error: message(error) }))
        .then((result) => {
          try {
            settle(item.name, slot.id, result);
          } catch (error) {
            console.error(`cannot save the sound for "${item.name}": ${message(error)}`);
          }
        });
      inFlight.add(job);
      void job.finally(() => inFlight.delete(job));
    });
  };

  return {
    view,

    openNames: () => state.open.map((item) => item.name),

    reject(items) {
      if (!Array.isArray(items) || items.length === 0) throw new ReviewError(400, 'send at least one sound');
      const entries = entriesByName();
      const seen = new Set<string>();
      const reasons = new Map<string, string>();
      for (const item of items) {
        const name = String(item?.name);
        if (!entries.has(name)) throw new ReviewError(400, `unknown sound "${name}"`);
        if (seen.has(name)) throw new ReviewError(400, `"${name}" is in the list twice`);
        seen.add(name);
        if (find(name)) throw new ReviewError(409, `"${name}" is already in redraw`);
        reasons.set(name, reasonOf(item.reason, name));
      }
      const draw = deps.draw;
      if (!draw) throw new ReviewError(503, NO_KEY_MESSAGE);

      const at = now().toISOString();
      const lines: RejectedLine[] = [...seen].map((name) => {
        const entry = entries.get(name)!;
        return {
          id: newId(),
          name,
          phrase: entry.phrase,
          category: entry.category,
          concept: entry.concept,
          patch: entry.patch,
          reason: reasons.get(name)!,
          origin: 'library',
          model: null,
          round: 0,
          rejectedAt: at,
        };
      });
      store.appendRejected(lines);
      const added: OpenItem[] = [...seen].map((name) => ({ name, round: 1, startedAt: at, slots: freshSlots() }));
      state.open.push(...added);
      store.writeSession(state);
      for (const item of added) startDrawings(item, entries.get(item.name)!, draw);
      return view();
    },

    decide(rows) {
      if (!Array.isArray(rows) || rows.length === 0) throw new ReviewError(400, 'send at least one row');
      const entries = entriesByName();
      const seen = new Set<string>();
      const reasons = new Map<string, string>();
      // Check the whole body before any write.
      for (const row of rows) {
        const name = String(row?.name);
        if (seen.has(name)) throw new ReviewError(400, `"${name}" is in the list twice`);
        seen.add(name);
        const item = find(name);
        if (!item || !entries.has(name)) throw new ReviewError(409, `"${name}" is not in the open work`);
        if (!CHOICES.includes(row.choice)) throw new ReviewError(400, `"${String(row.choice)}" is not a choice`);
        reasons.set(name, reasonOf(row.reason, name));
        if (item.slots.some((slot) => slot.status === 'pending')) {
          throw new ReviewError(409, `"${name}" still has a sound in progress`);
        }
        const index = SLOT_LABELS.indexOf(row.choice as SlotLabel);
        if (index === -1) continue;
        const slot = item.slots[index]!;
        if (slot.status !== 'ready') throw new ReviewError(400, `slot ${row.choice} of "${name}" has no sound`);
        const problems = checkEntry({ ...entries.get(name)!, concept: slot.concept!, patch: slot.patch! });
        if (problems.length > 0) {
          throw new ReviewError(409, `slot ${row.choice} of "${name}" fails the library check: ${problems.join('; ')}`);
        }
      }
      const draw = deps.draw;
      if (!draw && rows.some((row) => row.choice === 'redraw')) throw new ReviewError(503, NO_KEY_MESSAGE);

      // Library writes first. If one fails, the session is not changed yet,
      // so the same Submit can run again.
      let accepted = 0;
      for (const row of rows) {
        const index = SLOT_LABELS.indexOf(row.choice as SlotLabel);
        if (index === -1) continue;
        const slot = find(row.name)!.slots[index]!;
        const problems = store.replaceCandidate(row.name, { concept: slot.concept!, patch: slot.patch! });
        if (problems.length > 0) throw new ReviewError(409, `cannot write "${row.name}": ${problems.join('; ')}`);
        accepted += 1;
      }

      const at = now().toISOString();
      const lines: RejectedLine[] = [];
      const redraws: OpenItem[] = [];
      for (const row of rows) {
        const item = find(row.name)!;
        const entry = entries.get(row.name)!;
        const chosen = SLOT_LABELS.indexOf(row.choice as SlotLabel);
        item.slots.forEach((slot, index) => {
          if (slot.status !== 'ready' || index === chosen) return;
          lines.push({
            id: newId(),
            name: entry.name,
            phrase: entry.phrase,
            category: entry.category,
            concept: slot.concept!,
            patch: slot.patch!,
            reason: reasons.get(row.name)!,
            origin: 'generated',
            model: slot.model ?? null,
            round: item.round,
            rejectedAt: at,
          });
        });
        if (row.choice === 'redraw') {
          item.round += 1;
          item.startedAt = at;
          item.slots = freshSlots();
          redraws.push(item);
        } else {
          state.open = state.open.filter((open) => open !== item);
        }
      }
      // The rejected lines go in before the next round starts, so its prompt holds them.
      store.appendRejected(lines);
      store.writeSession(state);
      for (const item of redraws) startDrawings(item, entries.get(item.name)!, draw!);
      return { open: view(), accepted };
    },

    async idle() {
      while (inFlight.size > 0) await Promise.all([...inFlight]);
    },
  };
}
