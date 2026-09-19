# Semantic Sounds

**[semantic-sounds.com](https://semantic-sounds.com)**

A curated set of 1090 short sounds, found by plain prose. A sound is
data, not an audio file: each entry is a small JSON "patch" of
synthesis settings (oscillators, noise, envelopes, filters, pitch
sweeps), rendered in the page by one deterministic TypeScript renderer.

```ts
import { sounds, createSoundIndex, searchIndex, renderPatch } from 'semantic-sounds';

const index = createSoundIndex(sounds);
const [match] = searchIndex(index, 'the upload finished', { limit: 1 });
const samples = renderPatch(match.sound.patch); // Float32Array, 48kHz
```

The set covers 26 categories: interface feedback, transitions,
messages, progress, timers, games, media controls, nature, weather,
animals, mechanical, transport, smart home, system events, money,
social, health, food, office, navigation, emotion, abstract texture,
human body, sport, science and space, and musical instruments.

See `docs/sound-style-guide.md` for the contract every sound follows,
and `docs/superpowers/specs/2026-09-15-sound-contract-and-renderer-design.md`
for the full design.

## SDK

`createSemanticSounds` holds the index, the renderer and the WAV encoder
behind one object, so you assemble nothing.

```ts
import { createSemanticSounds } from 'semantic-sounds/sdk';

const sounds = createSemanticSounds();

sounds.find('my washing machine finished');   // the washer-done entry
sounds.search('a dog barking', { limit: 3 }); // ranked matches with scores
sounds.get('upload-complete');                // one entry by its stable name
sounds.categories();                          // 26 names, sorted

const entry = sounds.get('upload-complete')!;
sounds.durationMs(entry);   // 151
sounds.render(entry);       // Float32Array, mono, 48000 Hz
sounds.wav(entry);          // Uint8Array, a playable .wav file
```

`resolve` is the one call to make when you want a sound for an idea and
do not care where it comes from:

```ts
const answer = await sounds.resolve('the upload finished');
answer.origin;   // 'curated'
answer.patch;    // the patch to keep and render
```

The curated set answers first. When nothing scores high enough and a
`functionUrl` is configured, the service writes a new patch and `origin`
reports `generated`. That endpoint is sub-project 5 and is not built
yet. Without it, `resolve` throws a message that names the phrase.

The index builds once, and only when the first search asks for it.

## MCP server

```bash
claude mcp add semantic-sounds -- npx -y semantic-sounds-mcp
```

Five tools: `search_sounds`, `get_sound`, `list_categories`,
`list_category` and `resolve_sound`.

Every tool that answers with a sound gives its patch as JSON, with the
`renderPatch` lines under it. Set `preview: true` on `get_sound` or
`resolve_sound` to hear it: that adds a WAV audio block, rendered at
24000 Hz to keep it small. The patch in the same result always describes
the full 48000 Hz render.

Three environment variables configure generation, and all three are
optional. Without them the server stays offline and answers from the
curated set only.

| Variable | Meaning |
|---|---|
| `SEMANTIC_SOUNDS_FUNCTION_URL` | The generation endpoint. |
| `SEMANTIC_SOUNDS_API_KEY` | The bearer token for that endpoint. |
| `SEMANTIC_SOUNDS_MIN_SCORE` | The curated score needed to skip the model. |

## The site

One static page holds the whole set. A person types prose, sees a
waveform, clicks it, and takes the sound away as a patch or as a WAV
file. Nothing plays until a click.

The page also lets a person change a sound before they take it: **pitch**
in semitones, **speed**, and **loop** with a gap, to hear how a sound
feels when it fires again and again.

These change the patch, not the playback. A player that shifts pitch by
running a buffer faster moves time with it and cannot do one without the
other. Because a patch is data, the page writes a new patch and renders
it, so pitch and length move on their own -- and the file you download is
the sound you heard.

## Transforms

The same transforms are in the library, for any caller:

```ts
import { transpose, stretch, tweak } from 'semantic-sounds';

transpose(patch, 12);            // an octave up, same length
stretch(patch, 2);               // twice as long, same pitch
tweak(patch, { semitones: -5, stretch: 0.5 });
```

`transpose` moves the filter with the tone, so the timbre holds, and
leaves a noise layer alone, because a hiss has no key.

```bash
npm run site:build   # writes site/index.html, sitemap.xml and llms.txt
npm run site:serve   # look at it locally
npm run site:deploy  # Cloudflare Worker with static assets
```

The page carries the search engine, the renderer and all 1090 patches
inline: 96 KB gzipped. It makes no request of its own, so `_headers`
sets `connect-src 'none'`.

The site runs as a Cloudflare Worker with static assets, at
[semantic-sounds.com](https://semantic-sounds.com). `ORIGIN` in
`scripts/build-site.ts` is the one line that sets the domain.

`site:deploy` builds before it deploys. Deploying a stale page is worse
than not deploying, because nothing says the page is old.

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
npm run dev:web   # local player at the printed URL
npm run probe     # retrieval probe against labelled prose cases
npm run sounds:check  # contract check over every entry
npm run review    # local review tool at http://127.0.0.1:5179
```

The review tool plays each sound, records what you reject, and writes three
replacements for each rejection with `claude-opus-5`. It needs
`ANTHROPIC_API_KEY`. Set `REVIEW_FAKE_DRAW=1` to run it with a fake
generator that costs nothing. See
`docs/superpowers/specs/2026-09-19-sound-review-tool-design.md`.

## License

MIT © BirdTempo
