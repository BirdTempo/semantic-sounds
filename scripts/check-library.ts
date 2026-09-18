#!/usr/bin/env -S npx tsx
// Usage: npx tsx scripts/check-library.ts [path/to/file.json ...]
// With no arguments, checks every file under src/library/sounds/*.json.
//
// It reads every target file into one list and runs `checkLibrary`, so a
// duplicate name or phrase is found as well as a contract problem. A run
// over one file finds duplicates inside that file; the full run finds
// duplicates across the whole set.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { checkLibrary } from '../src/library/validate';
import type { SoundEntry } from '../src/library/types';

const soundsDir = join(process.cwd(), 'src', 'library', 'sounds');
const targetFiles =
  process.argv.length > 2
    ? process.argv.slice(2)
    : readdirSync(soundsDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => join(soundsDir, f));

const entries: SoundEntry[] = [];
const fileOf: string[] = [];
for (const file of targetFiles) {
  const list: SoundEntry[] = JSON.parse(readFileSync(file, 'utf8'));
  for (const entry of list) {
    entries.push(entry);
    fileOf.push(file);
  }
}

const results = checkLibrary(entries);
let totalProblems = 0;
for (const [key, problems] of results) {
  const index = Number(key.split(':')[0]);
  totalProblems += problems.length;
  console.log(`${fileOf[index]} :: ${entries[index]!.name}`);
  for (const problem of problems) console.log(`  - ${problem}`);
}

console.log(`\n${entries.length} entries checked, ${totalProblems} problems found.`);
process.exit(totalProblems > 0 ? 1 : 0);
