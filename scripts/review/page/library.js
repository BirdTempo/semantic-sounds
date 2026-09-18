// Screen 1: every library sound with a Yes / No choice, and a bar to send the
// No sounds to redraw.
import { api, draft, el } from '/common.js';
import { playButton, wireControls } from '/audio.js';

const DRAFT_KEY = 'sound-review:draft';
const CHUNK = 60;
const AHEAD = 800;

const grid = document.getElementById('grid');
const sentinel = document.getElementById('sentinel');
const summary = document.getElementById('summary');
const openLink = document.getElementById('open-link');
const message = document.getElementById('message');
const button = document.getElementById('redraw');
const count = document.getElementById('count');

let sounds = [];
let known = new Set();
let open = new Set();
let shown = 0;
// name -> reason, for each sound marked No. Every other sound is Yes.
const noes = new Map(Object.entries(draft.read(DRAFT_KEY) ?? {}));

const saveDraft = () => draft.write(DRAFT_KEY, Object.fromEntries(noes));
const marked = () => [...noes.keys()].filter((name) => known.has(name) && !open.has(name));
const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');

function updateBar() {
  const n = marked().length;
  summary.textContent = n + ' marked no';
  button.textContent = 'Redraw ' + plural(n, 'sound') + ' (' + plural(n * 3, 'generation') + ')';
  button.disabled = n === 0;
  openLink.hidden = open.size === 0;
  openLink.textContent = 'Open work: ' + plural(open.size, 'phrase');
}

function tile(sound) {
  const inRedraw = open.has(sound.name);
  const isNo = noes.has(sound.name) && !inRedraw;
  const card = el('article', { class: 'tile' + (isNo ? ' is-no' : '') + (inRedraw ? ' is-open' : '') });
  const play = playButton(sound.patch, sound.phrase);
  const yes = el('input', { type: 'radio', name: 'c-' + sound.name, value: 'yes', checked: !isNo, disabled: inRedraw });
  const no = el('input', { type: 'radio', name: 'c-' + sound.name, value: 'no', checked: isNo, disabled: inRedraw });
  const reason = el('input', {
    type: 'text',
    class: 'reason',
    placeholder: 'Reason (optional)',
    value: noes.get(sound.name) ?? '',
    hidden: !isNo,
  });

  const set = (value) => {
    if (value) noes.set(sound.name, reason.value);
    else noes.delete(sound.name);
    yes.checked = !value;
    no.checked = value;
    reason.hidden = !value;
    card.classList.toggle('is-no', value);
    saveDraft();
    updateBar();
  };
  yes.addEventListener('change', () => set(false));
  no.addEventListener('change', () => {
    set(true);
    reason.focus();
  });
  reason.addEventListener('input', () => {
    noes.set(sound.name, reason.value);
    saveDraft();
  });

  card.append(
    play,
    el('p', { class: 'phrase', textContent: sound.phrase }),
    el('p', { class: 'category', textContent: sound.category }),
    el('p', { class: 'concept', textContent: sound.concept }),
  );
  if (inRedraw) card.append(el('p', { class: 'badge', textContent: 'in redraw' }));
  card.append(el('div', { class: 'choice' }, [el('label', {}, [yes, 'Yes']), el('label', {}, [no, 'No'])]), reason);
  return card;
}

/** Add tiles until the sentinel is out of reach. The observer fires only on a change, so loop here. */
function fill() {
  while (shown < sounds.length && sentinel.getBoundingClientRect().top < window.innerHeight + AHEAD) {
    const next = sounds.slice(shown, shown + CHUNK);
    grid.append(...next.map(tile));
    shown += next.length;
  }
}

const observer = new IntersectionObserver(fill, { rootMargin: AHEAD + 'px' });

button.addEventListener('click', async () => {
  const items = marked().map((name) => ({ name, reason: noes.get(name) ?? '' }));
  if (items.length === 0) return;
  button.disabled = true;
  message.textContent = 'Sending…';
  try {
    await api('POST', '/api/reject', { items });
    draft.clear(DRAFT_KEY);
    location.href = '/redraw';
  } catch (error) {
    message.textContent = error.message;
    updateBar();
  }
});

wireControls();

try {
  const data = await api('GET', '/api/library');
  sounds = data.sounds;
  known = new Set(sounds.map((sound) => sound.name));
  open = new Set(data.open);
  count.textContent = sounds.length + ' sounds';
  updateBar();
  observer.observe(sentinel);
  fill();
} catch (error) {
  message.textContent = error.message;
}
