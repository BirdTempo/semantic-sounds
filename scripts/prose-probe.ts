import { sounds, createSoundIndex, searchIndex, LOCAL_MIN_SCORE } from '../src/library/index';

// `accept` lists the phrases that answer the query well. An empty list
// means the set should answer nothing. `acceptContains` accepts any phrase
// that holds the given word: bare one-word queries tie across every entry
// that owns the word, and the tie-break between them is arbitrary, so the
// case tests that the set answers with a sound about that word, not which
// of several equally right sounds wins.
type Case = { query: string; accept: string[]; acceptContains?: string };

const CASES: Case[] = [
  // Everyday phrasing, the original seed set
  { query: 'the file finished uploading', accept: ['upload complete'] },
  { query: 'nice, that worked', accept: ['success chime'] },
  { query: 'turn the setting on', accept: ['toggle on'] },
  { query: 'turn the setting off', accept: ['toggle off'] },
  { query: 'someone sent me a message', accept: ['message received'] },
  { query: 'my timer is done', accept: ['timer done'] },
  { query: 'wake up alarm going off', accept: ['alarm', 'wake alarm'] },
  { query: 'i just leveled up', accept: ['level up'] },
  { query: 'i picked up a coin', accept: ['coin pickup', 'coin collect'] },
  { query: 'close this menu', accept: ['menu close'] },
  { query: 'open the menu', accept: ['menu open'] },
  { query: 'i pressed a key', accept: ['key press'] },
  { query: 'the game is over', accept: ['game over'] },
  { query: 'i got an extra life', accept: ['extra life'] },
  { query: 'delete this item', accept: ['delete'] },
  { query: 'unlocked a new achievement', accept: ['achievement unlocked'] },
  { query: 'switch to the other tab', accept: ['tab switch'] },
  { query: 'a light tap on a button', accept: ['tap', 'tap light'] },
  { query: 'someone mentioned me', accept: ['mention alert', 'mention in comment'] },
  { query: 'snooze the alarm', accept: ['snooze', 'alarm snoozed again'] },
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
  { query: 'i finished a task on my list', accept: ['task complete'] },
  { query: 'the character jumps', accept: ['jump'] },
  { query: 'you won the game', accept: ['victory fanfare'] },
  { query: 'typing a message', accept: ['message typing'] },
  { query: 'a notification popped up', accept: ['notification ping'] },
  { query: 'something went wrong', accept: ['error buzz'] },
  { query: 'a warning appeared', accept: ['warning ping'] },
  { query: 'the clock is ticking', accept: ['timer tick', 'grandfather clock', 'tick soft'] },

  // Media controls
  { query: 'start playing the song', accept: ['play'] },
  { query: 'pause the music', accept: ['pause'] },
  { query: 'skip to the next track', accept: ['next track'] },
  { query: 'turn the volume up', accept: ['volume up'] },
  { query: 'mute the audio', accept: ['mute audio'] },
  { query: 'start recording', accept: ['record start'] },

  // Nature and weather
  { query: 'a drop of water', accept: ['water drop', 'dew drop'] },
  { query: 'waves on the beach', accept: ['ocean wave', 'gentle surf'] },
  { query: 'thunder in the distance', accept: ['distant thunder'] },
  { query: 'a crackling campfire', accept: ['crackling fire', 'campfire pop'] },
  { query: 'wind blowing through the leaves', accept: ['rustling leaves', 'wind gust', 'soft breeze'] },
  { query: 'heavy rain outside', accept: ['heavy rain', 'downpour', 'rain on window'] },
  { query: 'snow falling', accept: ['snowfall'] },
  { query: 'a tornado siren', accept: ['tornado siren'] },

  // Animals
  { query: 'a dog barking', accept: ['dog bark'] },
  { query: 'a cat purring', accept: ['cat purr'] },
  { query: 'an owl at night', accept: ['owl hoot'] },
  { query: 'a rooster in the morning', accept: ['rooster crow'] },
  { query: 'a wolf howling', accept: ['wolf howl'] },

  // Smart home and appliances
  { query: 'someone rang the doorbell', accept: ['doorbell', 'door chime'] },
  { query: 'the smoke alarm went off', accept: ['smoke detector', 'alarm'] },
  { query: 'my washing machine finished', accept: ['washer done'] },
  { query: 'the kettle has boiled', accept: ['kettle boiled', 'kettle whistle'] },
  { query: 'turn the lights on', accept: ['light on'] },

  // Transport and navigation
  { query: 'a car horn honking', accept: ['car horn'] },
  { query: 'a train pulling into the station', accept: ['train approach', 'station chime'] },
  { query: 'the plane is taking off', accept: ['plane takeoff'] },
  { query: 'the elevator arrived', accept: ['elevator arrive'] },
  { query: 'turn left at the next street', accept: ['turn left'] },
  { query: 'you have arrived at your destination', accept: ['destination reached'] },

  // Messages, system and money
  { query: 'my phone is ringing', accept: ['incoming call', 'ringtone soft', 'ringtone bright', 'phone desk ring'] },
  { query: 'i got a new email', accept: ['email arrived'] },
  { query: 'my battery is low', accept: ['battery low'] },
  { query: 'connected to wifi', accept: ['wifi connected'] },
  { query: 'the computer is starting up', accept: ['boot up'] },
  { query: 'i paid with my card', accept: ['card tap', 'card swipe', 'payment sent'] },
  { query: 'the cash register', accept: ['cash register'] },
  { query: 'my payment was declined', accept: ['payment declined'] },

  // Body, health and sport
  { query: 'my heart is beating', accept: ['heartbeat', 'heart thump'] },
  { query: 'take a deep breath', accept: ['deep breath cycle', 'breath in'] },
  { query: 'someone sneezed', accept: ['sneeze'] },
  { query: 'the referee blew the whistle', accept: ['whistle start', 'whistle end', 'referee call'] },
  { query: 'the crowd is cheering', accept: ['crowd roar', 'cheer'] },
  { query: 'i finished my workout', accept: ['workout done'] },

  // Instruments and texture
  { query: 'a single piano note', accept: ['piano note'] },
  { query: 'plucking a guitar string', accept: ['guitar pluck'] },
  { query: 'hitting a drum', accept: ['hand drum', 'kick drum', 'snare hit'] },
  { query: 'a gong being struck', accept: ['gong'] },
  { query: 'a low humming drone', accept: ['drone low', 'drone mid', 'machine hum'] },

  // Kitchen, office and space
  { query: 'frying something in a pan', accept: ['pan fry', 'sizzle start'] },
  { query: 'water boiling in a pot', accept: ['boil rolling'] },
  { query: 'the printer finished printing', accept: ['printer done'] },
  { query: 'a rocket launching', accept: ['rocket launch'] },
  { query: 'a radar sweep', accept: ['radar sweep'] },

  // Emotion
  { query: 'a feeling of dread', accept: ['dread'] },
  { query: 'a moment of calm', accept: ['calm settle', 'deep calm', 'serenity'] },

  // Word-traps: a bare word must return a sound about that word. Several
  // entries tie exactly, and the tie-break between them is arbitrary.
  { query: 'coin', accept: [], acceptContains: 'coin' },
  { query: 'open', accept: [], acceptContains: 'open' },
  { query: 'close', accept: [], acceptContains: 'close' },
  { query: 'complete', accept: [], acceptContains: 'complete' },

  // Honest gaps: the set has no answer for these
  { query: 'quantum entanglement', accept: [] },
  { query: 'a philosophical disagreement', accept: [] },
  { query: 'the smell of rain on hot pavement', accept: [] },
  { query: 'the taste of coffee', accept: [] },
];

// Cases the current design does not answer correctly, recorded rather than
// silently tolerated or quietly deleted. Each one is a real miss, with its
// cause. The engine is lexical: it matches words, and it cannot know which
// word of a query carries the intent.
//
// - "something went wrong": an entry is literally named "password wrong",
//   so it owns the word "wrong" in its phrase (weight 6). "error buzz"
//   carries "wrong" only as a keyword (weight 4) and loses. No global
//   weighting fixes this without demoting phrases everywhere.
// - "a warning appeared" / "a notification popped up": the generic verb
//   ("appear", "pop") is rarer across 1090 sounds than the subject noun
//   ("warning", "notification"), so rarity favours the wrong word. A
//   stopword list cannot help: "pop" is the real subject of "cork pop".
// - "a moment of calm": "moment" is rare, so it outweighs "calm", and
//   "bookmark moment" wins. Same cause as the two above.
// - "the smell of rain on hot pavement" / "the taste of coffee": these
//   asked for nothing when the set had no rain or coffee sound. It now has
//   both. A lexical engine must match them; only a semantic one could know
//   the query is about smell and taste, not sound.
const KNOWN_MISSES = new Set([
  'something went wrong',
  'a warning appeared',
  'a notification popped up',
  'a moment of calm',
  'the smell of rain on hot pavement',
  'the taste of coffee',
]);

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
    const wantsNothing = testCase.accept.length === 0 && !testCase.acceptContains;
    const ok = wantsNothing
      ? answer === null
      : answer !== null &&
        (testCase.accept.includes(answer) ||
          (testCase.acceptContains !== undefined && answer.split(' ').includes(testCase.acceptContains)));
    if (ok) {
      passed++;
    } else {
      failures.push(
        `"${testCase.query}" -> got ${answer ?? 'nothing'} (score ${top?.score.toFixed(1) ?? 'n/a'}), wanted one of [${testCase.accept.join(', ') || testCase.acceptContains || 'nothing'}]`
      );
    }
  }
  return { passed, total: CASES.length, failures };
}

// The regression baseline. Exit non-zero only if the pass count drops
// below it, so a real regression is distinguishable from the known misses
// listed above.
export const EXPECTED_MIN_PASSING = CASES.length - KNOWN_MISSES.size;

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = runProbe(LOCAL_MIN_SCORE);
  console.log(`${result.passed} of ${result.total} prose cases answered correctly at rank 1 (floor ${LOCAL_MIN_SCORE}).`);
  const unexpected = result.failures.filter((f) => ![...KNOWN_MISSES].some((k) => f.startsWith(`"${k}"`)));
  if (result.failures.length > 0) {
    console.log(`\nFailures (${result.failures.length}, of which ${result.failures.length - unexpected.length} known):`);
    for (const failure of result.failures) {
      const known = [...KNOWN_MISSES].some((k) => failure.startsWith(`"${k}"`));
      console.log(`  ${known ? '[known] ' : '[NEW]   '}${failure}`);
    }
  }
  process.exit(result.passed < EXPECTED_MIN_PASSING ? 1 : 0);
}
