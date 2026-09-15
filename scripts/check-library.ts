#!/usr/bin/env -S npx tsx
// Usage: npx tsx scripts/check-library.ts [path/to/file.json ...]
// With no arguments, checks every file under src/library/sounds/*.json.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { checkEntry } from '../src/library/validate';
import type { SoundEntry } from '../src/library/types';

const soundsDir = join(process.cwd(), 'src', 'library', 'sounds');
const targetFiles =
  process.argv.length > 2
    ? process.argv.slice(2)
    : readdirSync(soundsDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => join(soundsDir, f));

let totalProblems = 0;
let totalEntries = 0;

for (const file of targetFiles) {
  const entries: SoundEntry[] = JSON.parse(readFileSync(file, 'utf8'));
  for (const entry of entries) {
    totalEntries++;
    const problems = checkEntry(entry);
    if (problems.length > 0) {
      totalProblems += problems.length;
      console.log(`${file} :: ${entry.name}`);
      for (const problem of problems) console.log(`  - ${problem}`);
    }
  }
}

console.log(`\n${totalEntries} entries checked, ${totalProblems} problems found.`);
process.exit(totalProblems > 0 ? 1 : 0);
