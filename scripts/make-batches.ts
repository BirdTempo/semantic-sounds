#!/usr/bin/env -S npx tsx
// Usage: npx tsx scripts/make-batches.ts
//
// Read docs/sound-batches/phrases-*.json, derive a kebab-case `name` for
// every phrase, refuse any duplicate, and write one batch file per group
// of BATCH_SIZE phrases to docs/sound-batches/batches/.
//
// The manifest is the one place that owns uniqueness. Each authoring agent
// gets a disjoint list, so two agents can never write the same sound.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizePhrase } from '../src/library/normalize-phrase';
import type { SoundEntry } from '../src/library/types';

// A batch is one agent's whole job. Keep it under MAX_BATCH, and split a
// large category into equal parts rather than a full part plus a stub.
const MAX_BATCH = 30;
const docsDir = join(process.cwd(), 'docs', 'sound-batches');
const batchDir = join(docsDir, 'batches');
const soundsDir = join(process.cwd(), 'src', 'library', 'sounds');

export type BatchPhrase = { name: string; phrase: string; category: string };

const toName = (phrase: string): string =>
  phrase
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// Every phrase already in the library. The new set must not collide with it.
const taken = new Map<string, string>();
const takenNames = new Set<string>();
for (const file of readdirSync(soundsDir).filter((f) => f.endsWith('.json'))) {
  for (const entry of JSON.parse(readFileSync(join(soundsDir, file), 'utf8')) as SoundEntry[]) {
    taken.set(normalizePhrase(entry.phrase), `${file}:${entry.name}`);
    takenNames.add(entry.name);
  }
}

const phrases: BatchPhrase[] = [];
const problems: string[] = [];
const files = readdirSync(docsDir)
  .filter((f) => /^phrases-\d+\.json$/.test(f))
  .sort();

for (const file of files) {
  const groups = JSON.parse(readFileSync(join(docsDir, file), 'utf8')) as Record<string, string[]>;
  for (const [category, list] of Object.entries(groups)) {
    for (const phrase of list) {
      const key = normalizePhrase(phrase);
      const name = toName(phrase);
      const where = `${file} ${category} "${phrase}"`;
      if (taken.has(key)) problems.push(`${where}: phrase already used by ${taken.get(key)}`);
      else if (takenNames.has(name)) problems.push(`${where}: name "${name}" already used`);
      else {
        taken.set(key, where);
        takenNames.add(name);
        phrases.push({ name, phrase, category });
      }
    }
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`\n${problems.length} problems. No batch was written.`);
  process.exit(1);
}

// Group by category, then cut each category into batches. A batch never
// mixes categories, so one agent holds one sonic idea at a time.
const byCategory = new Map<string, BatchPhrase[]>();
for (const item of phrases) {
  if (!byCategory.has(item.category)) byCategory.set(item.category, []);
  byCategory.get(item.category)!.push(item);
}

if (existsSync(batchDir)) rmSync(batchDir, { recursive: true });
mkdirSync(batchDir, { recursive: true });

let batchNumber = 0;
const index: { batch: string; category: string; outputFile: string; count: number }[] = [];
for (const [category, list] of [...byCategory].sort()) {
  const parts = Math.ceil(list.length / MAX_BATCH);
  const per = Math.ceil(list.length / parts);
  for (let part = 0; part < parts; part += 1) {
    batchNumber += 1;
    const id = String(batchNumber).padStart(2, '0');
    const slice = list.slice(part * per, (part + 1) * per);
    const outputFile = `src/library/sounds/${category}${parts > 1 ? `-${part + 1}` : ''}.json`;
    const batchFile = join(batchDir, `batch-${id}.json`);
    writeFileSync(
      batchFile,
      JSON.stringify(
        { batch: `batch-${id}`, category, outputFile, phrases: slice.map(({ name, phrase }) => ({ name, phrase })) },
        null,
        2,
      ) + '\n',
    );
    index.push({ batch: `batch-${id}`, category, outputFile, count: slice.length });
  }
}

writeFileSync(join(batchDir, 'index.json'), JSON.stringify(index, null, 2) + '\n');
console.log(`${phrases.length} new phrases in ${index.length} batches (${taken.size} total with the existing set).`);
for (const row of index) console.log(`  ${row.batch}  ${String(row.count).padStart(2)}  ${row.outputFile}`);
