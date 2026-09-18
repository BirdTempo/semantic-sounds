# Semantic Sounds

A curated set of short UI sounds, found by plain prose. A sound is
data, not an audio file: each entry is a small JSON "patch" of
synthesis settings (oscillators, noise, envelopes, filters, pitch
sweeps), rendered in the page by one deterministic TypeScript renderer.

```ts
import { sounds, createSoundIndex, searchIndex, renderPatch } from 'semantic-sounds';

const index = createSoundIndex(sounds);
const [match] = searchIndex(index, 'the upload finished', { limit: 1 });
const samples = renderPatch(match.sound.patch); // Float32Array, 48kHz
```

See `docs/sound-style-guide.md` for the contract every sound follows,
and `docs/superpowers/specs/2026-09-15-sound-contract-and-renderer-design.md`
for the full design.

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
npm run dev:web   # local player at the printed URL
npm run probe     # retrieval probe against labelled prose cases
npm run review    # local review tool at http://127.0.0.1:5179
```

The review tool plays each sound, records what you reject, and writes three
replacements for each rejection with `claude-opus-5`. It needs
`ANTHROPIC_API_KEY`. Set `REVIEW_FAKE_DRAW=1` to run it with a fake
generator that costs nothing. See
`docs/superpowers/specs/2026-09-19-sound-review-tool-design.md`.

## License

MIT © BirdTempo
