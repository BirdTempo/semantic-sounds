// Screen 2: three new sounds for each rejected entry. They arrive one at a
// time through the event stream.
import { api, el, mergeSlots, redrawCounts } from '/common.js';
import { playButton, wireControls } from '/audio.js';

const LABELS = ['A', 'B', 'C'];

const rowsBox = document.getElementById('rows');
const summary = document.getElementById('summary');
const message = document.getElementById('message');
const submit = document.getElementById('submit');
const buildBox = document.getElementById('build');

let rows = [];
// name -> { choice, reason }. A row with no entry uses the default.
const choices = new Map();

const choiceOf = (name) => choices.get(name) ?? { choice: 'redraw', reason: '' };
const hasPending = (row) => row.slots.some((slot) => slot.status === 'pending');
const sectionOf = (name) => rowsBox.querySelector('[data-name="' + CSS.escape(name) + '"]');

function slotBoxes(row) {
  const current = el('div', { class: 'slot current' }, [
    el('p', { class: 'label', textContent: 'current' }),
    playButton(row.current.patch, 'current'),
    el('p', { class: 'concept', textContent: row.current.concept }),
  ]);
  const slots = row.slots.map((slot, index) => {
    const box = el('div', { class: 'slot is-' + slot.status }, [
      el('p', { class: 'label', textContent: LABELS[index] }),
    ]);
    if (slot.status === 'pending') box.append(el('div', { class: 'spinner', 'aria-label': 'Writing' }));
    else if (slot.status === 'failed') box.append(el('p', { class: 'error', textContent: slot.error || 'failed' }));
    else box.append(playButton(slot.patch, LABELS[index]), el('p', { class: 'concept', textContent: slot.concept }));
    return box;
  });
  return [current, ...slots];
}

function rowView(row) {
  const pick = choiceOf(row.name);
  const options = [
    ...LABELS.map((label, index) => ({ value: label, text: label, disabled: row.slots[index].status !== 'ready' })),
    { value: 'redraw', text: 'None, redraw', disabled: false },
    { value: 'keep', text: 'Keep current', disabled: false },
  ];
  const radios = options.map((option) => {
    const input = el('input', {
      type: 'radio',
      name: 'r-' + row.name,
      value: option.value,
      checked: pick.choice === option.value,
      disabled: option.disabled,
    });
    input.addEventListener('change', () => {
      choices.set(row.name, { ...choiceOf(row.name), choice: option.value });
      updateBar();
    });
    return el('label', {}, [input, option.text]);
  });
  const reason = el('input', {
    type: 'text',
    class: 'reason',
    placeholder: 'What is wrong with the sounds you reject? (optional)',
    value: pick.reason,
  });
  reason.addEventListener('input', () => choices.set(row.name, { ...choiceOf(row.name), reason: reason.value }));
  return el('section', { class: 'row', 'data-name': row.name }, [
    el('header', {}, [
      el('h2', { textContent: row.phrase }),
      el('span', { class: 'category', textContent: row.category + ' · round ' + row.round }),
    ]),
    el('div', { class: 'slots' }, slotBoxes(row)),
    el('div', { class: 'choice' }, radios),
    reason,
  ]);
}

/** Update one row in place, so a reason that is being typed keeps its focus. */
function refreshSlots(row) {
  const section = sectionOf(row.name);
  if (!section) return render();
  section.querySelector('.slots').replaceChildren(...slotBoxes(row));
  row.slots.forEach((slot, index) => {
    section.querySelector('input[value="' + LABELS[index] + '"]').disabled = slot.status !== 'ready';
  });
}

function updateBar() {
  const counts = redrawCounts(rows, choices);
  const waiting = rows.length - counts.ready;
  summary.textContent =
    'Accept ' +
    counts.accept +
    ' · Redraw ' +
    counts.redraw +
    ' (' +
    counts.redraw * 3 +
    ' generations) · Keep ' +
    counts.keep +
    (waiting > 0 ? ' · ' + waiting + ' still writing' : '');
  submit.disabled = counts.ready === 0;
}

function render() {
  if (rows.length === 0) {
    rowsBox.replaceChildren(
      el('div', { class: 'done' }, [
        el('h2', { textContent: 'Done' }),
        el('p', {}, ['No open work. ', el('a', { href: '/', textContent: 'Back to the library' })]),
      ]),
    );
  } else {
    rowsBox.replaceChildren(...rows.map(rowView));
  }
  updateBar();
}

async function load() {
  try {
    const data = await api('GET', '/api/session');
    rows = mergeSlots(data.open, rows);
    render();
  } catch (error) {
    message.textContent = error.message;
  }
}

function onSlot(event) {
  const row = rows.find((candidate) => candidate.slots.some((slot) => slot.id === event.id));
  // A slot this page has not seen: a new round from another tab. Load again.
  if (!row) return load();
  const index = row.slots.findIndex((slot) => slot.id === event.id);
  row.slots[index] = {
    id: event.id,
    status: event.status,
    concept: event.concept,
    patch: event.patch,
    error: event.error,
  };
  refreshSlots(row);
  updateBar();
}

submit.addEventListener('click', async () => {
  const ready = rows.filter((row) => !hasPending(row));
  if (ready.length === 0) return;
  submit.disabled = true;
  message.textContent = 'Saving…';
  try {
    const data = await api('POST', '/api/decide', {
      rows: ready.map((row) => ({ name: row.name, ...choiceOf(row.name) })),
    });
    for (const row of ready) choices.delete(row.name);
    rows = mergeSlots(data.open, rows);
    const failed = data.build && !data.build.ok;
    buildBox.hidden = !failed;
    buildBox.textContent = failed ? data.build.output : '';
    message.textContent = data.build
      ? failed
        ? 'The library build failed. See the output above.'
        : 'Library rebuilt.'
      : '';
    render();
  } catch (error) {
    message.textContent = error.message;
    updateBar();
  }
});

wireControls();

const events = new EventSource('/api/events');
events.addEventListener('slot', (event) => onSlot(JSON.parse(event.data)));
// Load on each connect and reconnect, so no event is lost in the gap.
events.addEventListener('open', load);
