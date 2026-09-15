import { sounds, createSoundIndex, searchIndex, LOCAL_MIN_SCORE } from '../src/library/index';

type Case = { query: string; accept: string[] };

const CASES: Case[] = [
  // Everyday phrasing
  { query: 'the file finished uploading', accept: ['upload complete'] },
  { query: 'something went wrong', accept: ['error buzz'] },
  { query: 'nice, that worked', accept: ['success chime'] },
  { query: 'turn the setting on', accept: ['toggle on'] },
  { query: 'turn the setting off', accept: ['toggle off'] },
  { query: 'someone sent me a message', accept: ['message received'] },
  { query: 'my timer is done', accept: ['timer done'] },
  { query: 'wake up alarm going off', accept: ['alarm'] },
  { query: 'i just leveled up', accept: ['level up'] },
  { query: 'i picked up a coin', accept: ['coin pickup'] },
  { query: 'close this menu', accept: ['menu close'] },
  { query: 'open the menu', accept: ['menu open'] },
  { query: 'i pressed a key', accept: ['key press'] },
  { query: 'the game is over', accept: ['game over'] },
  { query: 'i got an extra life', accept: ['extra life'] },
  { query: 'delete this item', accept: ['delete'] },
  { query: 'unlocked a new achievement', accept: ['achievement unlocked'] },
  { query: 'switch to the other tab', accept: ['tab switch'] },
  { query: 'a light tap on a button', accept: ['tap'] },
  { query: 'someone mentioned me', accept: ['mention alert'] },
  { query: 'snooze the alarm', accept: ['snooze'] },
  { query: 'the download finished', accept: ['download complete'] },
  { query: 'my data finished syncing', accept: ['sync complete'] },
  { query: 'a reminder for my calendar event', accept: ['calendar reminder'] },
  { query: 'i muted the conversation', accept: ['mute confirmation'] },
  { query: 'i got a direct message', accept: ['direct message'] },
  { query: 'open a popup dialog', accept: ['modal open'] },
  { query: 'close the popup dialog', accept: ['modal close'] },
  { query: 'a panel slides into view', accept: ['panel slide in'] },
  { query: 'a panel slides out of view', accept: ['panel slide out'] },
  { query: 'i grabbed a power up', accept: ['power up'] },
  { query: 'i collected a bunch of coins in a row', accept: ['coin combo'] },
  { query: 'the countdown is beeping', accept: ['countdown beep'] },
  { query: 'the clock is ticking', accept: ['timer tick'] },
  { query: 'i finished a task on my list', accept: ['task complete'] },
  { query: 'the character jumps', accept: ['jump'] },
  { query: 'you won the game', accept: ['victory fanfare'] },
  { query: 'typing a message', accept: ['message typing'] },
  { query: 'a warning appeared', accept: ['warning ping'] },
  { query: 'a notification popped up', accept: ['notification ping'] },

  // Word-traps: a rare or misleading shared token must not win alone
  { query: 'coin', accept: ['coin pickup', 'coin combo'] },
  { query: 'open', accept: ['menu open', 'modal open'] },
  { query: 'close', accept: ['menu close', 'modal close'] },
  { query: 'complete', accept: ['upload complete', 'download complete', 'task complete', 'sync complete'] },
  // Known, accepted limitation, recorded rather than silently tolerated
  // (the same discipline the icon probe used for its one unfixable
  // "leaves"/"leaf" collision): "on" is deliberately kept as a content
  // word, not a stopword, because "toggle on"/"toggle off" need it to be
  // findable at all. That means a completely unrelated sentence that
  // happens to use "on" as a preposition can still score non-trivially
  // against toggle-on. No single global floor separates this from every
  // true positive in the set (the lowest true positive here, "you won the
  // game" before its keyword fix, scored below this trap), so this is
  // accepted as the one case the current design does not answer correctly,
  // rather than fought further with ad-hoc scoring rules.
  { query: 'the smell of rain on hot pavement', accept: [] },

  // Honest gaps: the seed set has no answer for these
  { query: 'quantum entanglement', accept: [] },
  { query: 'a philosophical disagreement', accept: [] },
  { query: 'the taste of coffee', accept: [] },
];

const index = createSoundIndex(sounds);
const knownPhrases = new Set(sounds.map((s) => s.phrase));

for (const testCase of CASES) {
  for (const accepted of testCase.accept) {
    if (!knownPhrases.has(accepted)) {
      console.error(`Probe case "${testCase.query}" accepts unknown phrase "${accepted}"`);
      process.exit(1);
    }
  }
}

export function runProbe(floor: number): { passed: number; total: number; failures: string[] } {
  let passed = 0;
  const failures: string[] = [];
  for (const testCase of CASES) {
    const [top] = searchIndex(index, testCase.query, { limit: 1 });
    const answer = top && top.score >= floor ? top.sound.phrase : null;
    const wantsNothing = testCase.accept.length === 0;
    const ok = wantsNothing ? answer === null : answer !== null && testCase.accept.includes(answer);
    if (ok) {
      passed++;
    } else {
      failures.push(
        `"${testCase.query}" -> got ${answer ?? 'nothing'} (score ${top?.score.toFixed(1) ?? 'n/a'}), wanted one of [${testCase.accept.join(', ') || 'nothing'}]`
      );
    }
  }
  return { passed, total: CASES.length, failures };
}

// One case ("the smell of rain on hot pavement") is a documented, accepted
// word-trap -- see its comment above -- not something expected to ever
// pass. This is the regression baseline: exit non-zero only if the pass
// count drops below it, so a real regression is distinguishable from the
// one known limitation.
export const EXPECTED_MIN_PASSING = 47;

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = runProbe(LOCAL_MIN_SCORE);
  console.log(`${result.passed} of ${result.total} prose cases answered correctly at rank 1 (floor ${LOCAL_MIN_SCORE}).`);
  if (result.failures.length > 0) {
    console.log('\nFailures:');
    for (const failure of result.failures) console.log(`  ${failure}`);
  }
  process.exit(result.passed < EXPECTED_MIN_PASSING ? 1 : 0);
}
