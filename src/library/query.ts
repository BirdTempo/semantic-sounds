import type { SoundEntry, SoundMatch } from './types';
import { terms, aliasKey, rawKey } from './normalize';

export type { SoundEntry, SoundMatch };

const WEIGHT_PHRASE = 6;
const WEIGHT_KEYWORD = 4;
const WEIGHT_CATEGORY = 1;
const MAX_KEYWORD_HITS = 2;
const COVERAGE_FLOOR = 0.5;
const COVERAGE_POWER = 1.6;
const EXACT_PHRASE_BONUS = 140;
const EXACT_KEYWORD_BONUS = 100;
const SHADED_KEYWORD_BONUS = 30;
const RAW_PHRASE_BONUS = 70;
const CONTAINED_ALIAS_BONUS = 14;
const CONTAINED_PHRASE_BONUS = 40;

// Chosen provisionally; re-derived by grid search against the probe in
// scripts/tune-thresholds.ts once the seed set and probe both exist.
export const LOCAL_MIN_SCORE = 38;

const COURTESY = new Set(['please', 'thank', 'thanks', 'sorry', 'hello', 'hi', 'ok', 'okay']);

type Posting = Map<number, number>;

export type SoundIndex = {
  entries: SoundEntry[];
  postings: Map<string, Posting>;
  documentFrequency: Map<string, number>;
  phraseAlias: Map<string, number>;
  aliasWordCount: Map<string, number>;
  totalEntries: number;
};

export type SearchOptions = {
  limit?: number;
  minScore?: number;
};

function addPosting(postings: Map<string, Posting>, term: string, entryIndex: number, weight: number): void {
  let posting = postings.get(term);
  if (!posting) {
    posting = new Map();
    postings.set(term, posting);
  }
  posting.set(entryIndex, (posting.get(entryIndex) ?? 0) + weight);
}

export function createSoundIndex(entries: SoundEntry[]): SoundIndex {
  const postings = new Map<string, Posting>();
  const documentFrequency = new Map<string, number>();
  const phraseAlias = new Map<string, number>();
  const aliasWordCount = new Map<string, number>();

  entries.forEach((entry, i) => {
    const nameWords = entry.name.replace(/-/g, ' ');
    const phraseTerms = new Set([...terms(entry.phrase), ...terms(nameWords)]);
    const phraseKey = aliasKey(entry.phrase);
    const nameKey = aliasKey(nameWords);

    for (const term of phraseTerms) addPosting(postings, term, i, WEIGHT_PHRASE);
    if (!phraseAlias.has(phraseKey)) phraseAlias.set(phraseKey, i);
    if (!phraseAlias.has(nameKey)) phraseAlias.set(nameKey, i);
    aliasWordCount.set(phraseKey, phraseKey.split(' ').filter(Boolean).length);

    for (const term of terms(entry.category)) addPosting(postings, term, i, WEIGHT_CATEGORY);

    const keywordHits = new Map<string, number>();
    for (const keyword of entry.keywords) {
      const kwKey = aliasKey(keyword);
      aliasWordCount.set(kwKey, kwKey.split(' ').filter(Boolean).length);
      for (const term of terms(keyword)) {
        keywordHits.set(term, (keywordHits.get(term) ?? 0) + 1);
      }
    }
    for (const [term, hits] of keywordHits) {
      addPosting(postings, term, i, WEIGHT_KEYWORD * Math.min(hits, MAX_KEYWORD_HITS));
    }
  });

  for (const [term, posting] of postings) {
    documentFrequency.set(term, posting.size);
  }

  return { entries, postings, documentFrequency, phraseAlias, aliasWordCount, totalEntries: entries.length };
}

function rarity(index: SoundIndex, term: string): number {
  const df = index.documentFrequency.get(term) ?? index.totalEntries;
  return Math.log(1 + index.totalEntries / Math.max(df, 1));
}

function coverageMultiplier(matchedCount: number, queryCount: number): number {
  if (queryCount === 0) return 0;
  const coverage = matchedCount / queryCount;
  return COVERAGE_FLOOR + (1 - COVERAGE_FLOOR) * Math.pow(coverage, COVERAGE_POWER);
}

function containsRun(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

export function searchIndex(index: SoundIndex, query: string, options: SearchOptions = {}): SoundMatch[] {
  const limit = options.limit ?? 10;
  const minScore = options.minScore ?? -Infinity;
  const queryTerms = terms(query);
  const queryTermSet = new Set(queryTerms);
  const queryKey = aliasKey(query);
  const rawQueryKey = rawKey(query);

  const scores = new Map<number, number>();
  const matchedTerms = new Map<number, Set<string>>();

  for (const term of queryTermSet) {
    const posting = index.postings.get(term);
    if (!posting) continue;
    const r = rarity(index, term);
    for (const [entryIndex, weight] of posting) {
      scores.set(entryIndex, (scores.get(entryIndex) ?? 0) + weight * r);
      const set = matchedTerms.get(entryIndex) ?? new Set<string>();
      set.add(term);
      matchedTerms.set(entryIndex, set);
    }
  }

  const results: SoundMatch[] = [];
  for (const [entryIndex, rawScore] of scores) {
    const matched = matchedTerms.get(entryIndex) ?? new Set<string>();
    let score = rawScore * coverageMultiplier(matched.size, queryTermSet.size);

    const entry = index.entries[entryIndex];
    if (!entry) continue;
    const phraseKey = aliasKey(entry.phrase);

    if (queryKey.length > 0 && queryKey === phraseKey) {
      score += EXACT_PHRASE_BONUS;
    }

    for (const keyword of entry.keywords) {
      if (queryKey.length > 0 && aliasKey(keyword) === queryKey) {
        const namesOtherPhrase = [...index.phraseAlias.keys()].some(
          (key) => key !== phraseKey && key.length > 0 && !COURTESY.has(key) && queryKey.includes(key)
        );
        score += namesOtherPhrase ? SHADED_KEYWORD_BONUS : EXACT_KEYWORD_BONUS;
        break;
      }
    }

    const rawPhraseKey = rawKey(entry.phrase);
    if (rawQueryKey.length > 0 && rawQueryKey === rawPhraseKey) {
      score += RAW_PHRASE_BONUS;
    }

    const wordCount = index.aliasWordCount.get(phraseKey) ?? phraseKey.split(' ').filter(Boolean).length;
    if (phraseKey.length > 0 && containsRun(queryTerms, phraseKey.split(' '))) {
      score += CONTAINED_PHRASE_BONUS * wordCount;
    }
    for (const keyword of entry.keywords) {
      const kwKey = aliasKey(keyword);
      const kwWordCount = kwKey.split(' ').filter(Boolean).length;
      if (kwWordCount > 1 && containsRun(queryTerms, kwKey.split(' '))) {
        score += CONTAINED_ALIAS_BONUS * kwWordCount;
        break;
      }
    }

    results.push({ sound: entry, score, matched: [...matched] });
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.sound.phrase.length !== b.sound.phrase.length) return a.sound.phrase.length - b.sound.phrase.length;
    return a.sound.name.localeCompare(b.sound.name);
  });

  return results.filter((r) => r.score >= minScore).slice(0, limit);
}

export function bestMatch(index: SoundIndex, query: string, options: SearchOptions = {}): SoundMatch | null {
  const minScore = options.minScore ?? LOCAL_MIN_SCORE;
  const [top] = searchIndex(index, query, { limit: 1 });
  if (!top || top.score < minScore) return null;
  return top;
}
