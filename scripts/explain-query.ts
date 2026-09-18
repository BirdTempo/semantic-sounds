#!/usr/bin/env -S npx tsx
// Usage: npx tsx scripts/explain-query.ts "a query" ["another"]
// Print the top matches for each query, with the keywords that won.
import { sounds, createSoundIndex, searchIndex } from '../src/library/index';

const index = createSoundIndex(sounds);
for (const query of process.argv.slice(2)) {
  console.log(`\n== ${query}`);
  for (const result of searchIndex(index, query, { limit: 5 })) {
    console.log(`   ${result.score.toFixed(1).padStart(7)}  ${result.sound.phrase}  [${result.sound.keywords.join(', ')}]`);
  }
}
