// Helpers shared by both review screens. A plain ES module with no imports,
// so the browser loads it as is and Vitest can test it.

/** Call the review API. On a failure, throw an Error with the server's message. */
export async function api(method, path, body) {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'HTTP ' + response.status);
  return data;
}

/** Make an element. `attrs` sets properties, except `class`, `data-*` and `aria-*`. */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key.startsWith('data-') || key.startsWith('aria-')) node.setAttribute(key, value);
    else node[key] = value;
  }
  node.append(...children);
  return node;
}

/** localStorage that never throws. A private window can block it, and the page works without it. */
export const draft = {
  read(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || 'null');
    } catch {
      return null;
    }
  },
  write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* no storage: keep the choices in memory only */
    }
  },
  clear(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* no storage: nothing to clear */
    }
  },
};

const hasPending = (row) => row.slots.some((slot) => slot.status === 'pending');

/** Counts for the screen 2 bar. A row with a pending slot is not counted. */
export function redrawCounts(rows, choices) {
  const counts = { accept: 0, redraw: 0, keep: 0, ready: 0 };
  for (const row of rows) {
    if (hasPending(row)) continue;
    counts.ready += 1;
    const choice = choices.get(row.name)?.choice ?? 'redraw';
    if (choice === 'redraw') counts.redraw += 1;
    else if (choice === 'keep') counts.keep += 1;
    else counts.accept += 1;
  }
  return counts;
}

/**
 * Join fresh rows from the server with the slots the page already has. An
 * event can arrive while a fetch is in flight, so the fetch can hold an older
 * `pending` for a slot the page already shows as settled. Keep the settled one.
 */
export function mergeSlots(next, previous) {
  const known = new Map(previous.flatMap((row) => row.slots.map((slot) => [slot.id, slot])));
  return next.map((row) => ({
    ...row,
    slots: row.slots.map((slot) => {
      const old = known.get(slot.id);
      return slot.status === 'pending' && old && old.status !== 'pending' ? old : slot;
    }),
  }));
}
