// Types for common.js, which ships to the browser as plain JavaScript.
export type Slot = { id: string; status: string; concept?: string; patch?: unknown; error?: string };
export type Row = { name: string; slots: Slot[] };
export type Choice = { choice: string; reason?: string };

export function api(method: string, path: string, body?: unknown): Promise<any>;
export function el(tag: string, attrs?: Record<string, unknown>, children?: unknown[]): HTMLElement;
export const draft: {
  read(key: string): unknown;
  write(key: string, value: unknown): void;
  clear(key: string): void;
};
export function redrawCounts(
  rows: Row[],
  choices: Map<string, Choice>,
): { accept: number; redraw: number; keep: number; ready: number };
export function mergeSlots(next: Row[], previous: Row[]): Row[];
