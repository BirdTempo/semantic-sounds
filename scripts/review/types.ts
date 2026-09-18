// Shared shapes for the sound review tool.
import type { Patch, SoundEntry } from '../../src/library/types.js';

export const SLOT_LABELS = ['A', 'B', 'C'] as const;
export type SlotLabel = (typeof SLOT_LABELS)[number];

export type SlotStatus = 'pending' | 'ready' | 'failed';

export type Slot = {
  id: string;
  status: SlotStatus;
  concept?: string;
  patch?: Patch;
  model?: string;
  error?: string;
};

/** One phrase that waits on screen 2. */
export type OpenItem = {
  name: string;
  round: number;
  startedAt: string;
  slots: Slot[];
};

export type SessionFile = { open: OpenItem[] };

/** One line of `scripts/review/rejected.jsonl`. */
export type RejectedLine = {
  id: string;
  name: string;
  phrase: string;
  category: string;
  concept: string;
  patch: Patch;
  reason: string;
  origin: 'library' | 'generated';
  model: string | null;
  round: number;
  rejectedAt: string;
};

export type Choice = SlotLabel | 'redraw' | 'keep';

export type Candidate = { concept: string; patch: Patch; model: string };

export type DrawResult = { ok: true; candidate: Candidate } | { ok: false; error: string };

export type DrawRequest = { entry: SoundEntry; slot: SlotLabel; rejected: RejectedLine[] };

export type SlotEvent = {
  name: string;
  round: number;
  slot: SlotLabel;
  id: string;
  status: SlotStatus;
  concept?: string;
  patch?: Patch;
  error?: string;
};

/** An open item joined with its library entry, for the page. */
export type OpenView = OpenItem & {
  phrase: string;
  category: string;
  current: { concept: string; patch: Patch | null };
};
