const IRREGULAR: Record<string, string> = {
  children: 'child',
  mice: 'mouse',
  feet: 'foot',
  teeth: 'tooth',
  geese: 'goose',
  men: 'man',
  women: 'woman',
  people: 'person',
  agreed: 'agree',
  freed: 'free',
};

// Generic function/grammar words only. Direction, state, and register words
// (up, down, on, off, open, close, start, stop, low, high, short, long,
// fast, slow, no, not) are deliberately kept: they carry meaning for a
// sound library the way "up"/"down" carry meaning for an icon library.
const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'to', 'for', 'and', 'or', 'is', 'are', 'was',
  'were', 'be', 'been', 'being', 'it', 'its', 'this', 'that', 'these',
  'those', 'with', 'as', 'at', 'by', 'from', 'into', 'than', 'then',
  'so', 'such', 'very', 'i', 'you', 'he', 'she', 'we', 'they', 'my',
  'your', 'his', 'her', 'our', 'their', 'me', 'him', 'them', 'us',
  'someone', 'something', 'there', 'here', 'what', 'when', 'how',
  'just', 'has', 'have', 'had', 'does', 'did', 'about', 'if',
]);

function isVowel(ch: string): boolean {
  return 'aeiou'.includes(ch);
}

function hasVowel(text: string): boolean {
  for (const ch of text) {
    if (isVowel(ch)) return true;
  }
  return false;
}

function undouble(text: string): string {
  if (text.length < 2) return text;
  const last = text[text.length - 1] ?? '';
  const secondLast = text[text.length - 2] ?? '';
  if (last === secondLast && !isVowel(last) && last !== 'l' && last !== 's' && last !== 'f') {
    return text.slice(0, -1);
  }
  return text;
}

/** Porter's measure: how many vowel-then-consonant groups a stem holds. */
function measure(text: string): number {
  let m = 0;
  let i = 0;
  while (i < text.length && !isVowel(text[i]!)) i += 1;
  while (i < text.length) {
    while (i < text.length && isVowel(text[i]!)) i += 1;
    if (i >= text.length) break;
    while (i < text.length && !isVowel(text[i]!)) i += 1;
    m += 1;
  }
  return m;
}

/**
 * Finish a stem that just lost "-ing" or "-ed". Undoubling and restoring
 * an "e" are alternatives, never both: "running" drops the doubled "n" to
 * reach "run", and must not then grow an "e" into "rune".
 */
function restore(stripped: string): string {
  const undoubled = undouble(stripped);
  if (undoubled !== stripped) return undoubled;
  return measure(stripped) === 1 && needsRestoredE(stripped) ? stripped + 'e' : stripped;
}

/**
 * True for a consonant-vowel-consonant tail whose last letter is not w, x
 * or y. English put an "e" there before "-ing" or "-ed" came off:
 * tak(e)ing, mov(e)ing, sav(e)d.
 */
function needsRestoredE(text: string): boolean {
  if (text.length < 3) return false;
  const [a, b, c] = [text[text.length - 3]!, text[text.length - 2]!, text[text.length - 1]!];
  return !isVowel(a) && isVowel(b) && !isVowel(c) && c !== 'w' && c !== 'x' && c !== 'y';
}

/**
 * The last normalization, applied to every stem whether or not a suffix
 * came off. Both halves must run on both forms, or the two never meet:
 * "purring" undoubles to "pur" while "purr" stays "purr", and "sneezed"
 * loses its "e" while "sneeze" keeps it.
 *
 * The trailing "e" goes only from a word of six letters or more. That
 * keeps the short words this library needs as distinct content words:
 * "one" must not become "on", which "toggle on" owns.
 */
function normalizeTail(text: string): string {
  const undoubled = undouble(text);
  if (undoubled.length >= 6 && undoubled.endsWith('e')) return undoubled.slice(0, -1);
  return undoubled;
}

export function stem(word: string): string {
  return normalizeTail(stemCore(word));
}

function stemCore(word: string): string {
  const irregular = IRREGULAR[word];
  if (irregular) return irregular;
  if (word.length <= 3) return word;

  if (word.endsWith('ies') && word.length > 4) {
    return word.slice(0, -3) + 'y';
  }

  if (
    (word.endsWith('sses') || word.endsWith('shes') || word.endsWith('ches') || word.endsWith('xes')) &&
    word.length > 4
  ) {
    return word.slice(0, -2);
  }

  if (word.endsWith('oes') && word.length > 4) {
    return word.slice(0, -2);
  }

  if (word.endsWith('ing') && word.length > 5) {
    const stripped = word.slice(0, -3);
    if (hasVowel(stripped)) return restore(stripped);
  }

  if (word.endsWith('ed') && word.length > 4) {
    const stripped = word.slice(0, -2);
    if (hasVowel(stripped)) return restore(stripped);
  }

  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) {
    const lastTwo = word.slice(-2);
    if (lastTwo !== 'us' && lastTwo !== 'is' && lastTwo !== 'ns') {
      return word.slice(0, -1);
    }
  }

  return word;
}

function foldAccents(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function words(text: string): string[] {
  const cleaned = foldAccents(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  return cleaned.split(' ').filter((word) => word.length > 0);
}

export function terms(text: string): string[] {
  return words(text)
    .filter((word) => !STOPWORDS.has(word))
    .map(stem);
}

export function aliasKey(text: string): string {
  return terms(text).join(' ');
}

export function rawKey(text: string): string {
  return words(text)
    .filter((word) => !STOPWORDS.has(word))
    .join(' ');
}
