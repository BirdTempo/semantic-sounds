#!/usr/bin/env -S npx tsx
// Usage: npx tsx scripts/prune-stolen-keywords.ts [--write]
//
// Find and remove a keyword that steals a sibling entry's query.
//
// The style guide says: "Name the sound's own subject, not a scene around
// it." 46 authors worked in parallel, and many listed a sibling's subject
// as a keyword: "cat meow" listed "purr", "plane landing" listed "takeoff".
// Each theft makes the two entries tie on the query that should separate
// them, and the tie-break is arbitrary.
//
// A keyword is stolen when:
//   1. another entry's phrase holds that word, and
//   2. the two entries share a different phrase word (they are siblings),
//      and
//   3. this entry's own phrase does not hold the word.
//
// Condition 2 keeps the rule narrow. An unrelated entry may still use a
// common word; only a sibling that competes for the same query loses it.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { terms } from '../src/library/normalize';
import { MIN_KEYWORDS } from '../src/library/validate';
import type { SoundEntry } from '../src/library/types';

const soundsDir = join(process.cwd(), 'src', 'library', 'sounds');
const write = process.argv.includes('--write');

const files = readdirSync(soundsDir).filter((f) => f.endsWith('.json'));
const byFile = new Map<string, SoundEntry[]>();
const all: { entry: SoundEntry; file: string }[] = [];
for (const file of files) {
  const entries: SoundEntry[] = JSON.parse(readFileSync(join(soundsDir, file), 'utf8'));
  byFile.set(file, entries);
  for (const entry of entries) all.push({ entry, file });
}

const phraseTermsOf = new Map<SoundEntry, Set<string>>();
for (const { entry } of all) phraseTermsOf.set(entry, new Set(terms(entry.phrase)));

// term -> the entries whose phrase holds it
const owners = new Map<string, SoundEntry[]>();
for (const { entry } of all) {
  for (const term of phraseTermsOf.get(entry)!) {
    if (!owners.has(term)) owners.set(term, []);
    owners.get(term)!.push(entry);
  }
}

let removed = 0;
let touched = 0;
const changedFiles = new Set<string>();
const report: string[] = [];

for (const { entry, file } of all) {
  const mine = phraseTermsOf.get(entry)!;
  const keep: string[] = [];
  const dropped: string[] = [];
  for (const keyword of entry.keywords) {
    const kwTerms = terms(keyword);
    // A multi-word keyword is an alias for a whole query ("someone sent me
    // a message"), not a subject word. It cannot steal a sibling's noun,
    // and it is what makes natural phrasing findable. Keep every one.
    const steals = kwTerms.length === 1 && kwTerms.some((term) => {
      if (mine.has(term)) return false;
      const holders = owners.get(term);
      if (!holders) return false;
      // A sibling is another entry that owns this word in its phrase and
      // shares a different phrase word with this entry.
      return holders.some(
        (other) => other !== entry && [...phraseTermsOf.get(other)!].some((t) => t !== term && mine.has(t)),
      );
    });
    if (steals) dropped.push(keyword);
    else keep.push(keyword);
  }
  // Never break the contract. Put back the last-dropped keywords if the
  // entry would fall under the minimum.
  while (keep.length < MIN_KEYWORDS && dropped.length > 0) keep.push(dropped.pop()!);
  if (dropped.length === 0) continue;
  touched += 1;
  removed += dropped.length;
  changedFiles.add(file);
  report.push(`${entry.phrase}  --  ${dropped.join(', ')}`);
  entry.keywords = keep;
}

for (const line of report.slice(0, 40)) console.log(line);
if (report.length > 40) console.log(`... and ${report.length - 40} more`);
console.log(`\n${removed} stolen keywords on ${touched} entries in ${changedFiles.size} files.`);

if (write) {
  for (const file of changedFiles) {
    writeFileSync(join(soundsDir, file), JSON.stringify(byFile.get(file), null, 2) + '\n');
  }
  console.log('written.');
} else {
  console.log('dry run. Pass --write to apply.');
}
