# Sub-project 4: SDK, WAV encoder, and MCP server

Status: approved for planning
Date: 2026-09-19
Author: BirdTempo, with Claude Opus 5

## 1. Goal

Make the 1090-sound set usable from outside this repository.

Sub-projects 1 to 3 built the contract, the renderer, the validator, the
prose search, the review tool, and the full set. All of it is internal.
A caller who installs the package today gets loose functions and must
assemble them. A coding agent gets nothing.

This sub-project delivers three things:

- A WAV encoder, so a rendered sound becomes a file that any player
  reads. Without it the set is unusable outside a browser page.
- One SDK object, `createSemanticSounds`, that holds the index, the
  renderer, and the encoder behind a small surface.
- An MCP server with five tools, published as `semantic-sounds-mcp`, so
  a coding agent searches a real sound set instead of an invented file
  name.

## 2. Reference project

`semantic-icons` (`/Users/admin/Documents/code/semantic-icons`) has the
same three parts already. This spec copies its structure on purpose:

- `src/sdk.ts` exports one factory, `createSemanticIcons(options)`.
- `src/mcp/server.ts` exports `createServer(sdk)` and
  `fromEnvironment(env)`. The server takes the SDK as an argument, so a
  test drives it with no transport.
- `src/mcp/stdio.ts` is the `bin` entry. It connects the server to a
  `StdioServerTransport` and nothing else.
- `packages/semantic-icons-mcp/` is a thin wrapper package. Its only
  file of substance is a `bin.mjs` that imports the stdio entry from the
  main package.

The differences all come from one fact: an icon's payload is an SVG
string, which is text an agent can paste. A sound's payload is a patch,
which must be rendered before a person hears it. Section 4 covers what
that changes.

## 3. Out of scope

- The generation endpoint (sub-project 5). The SDK accepts a
  `functionUrl` and calls it when the set has no answer. No endpoint is
  built here. Without a URL the SDK stays offline and `resolve` reports
  that generation is not configured.
- The public static site (sub-project 6).
- Publication to npm. The build, the wrapper package, and the version
  numbers are prepared here. `npm publish` stays a manual step for the
  author, because it cannot be withdrawn.

## 4. What a sound needs that an icon does not

An agent that asks for an icon gets an SVG and is finished. An agent
that asks for a sound needs one of two things, and the server gives
both:

1. **The patch.** This is the artifact to write into code. It is small
   JSON. The agent stores it and calls `renderPatch` at run time.
2. **A preview.** A person must hear the sound to accept it. MCP carries
   an audio content block with base64 data, so the server can attach a
   WAV.

A preview is large. A 500 ms sound at 48000 Hz in 16-bit mono is 48000
bytes, about 64 KB as base64. That is too much to send on every call.
So:

- `preview` is a parameter, and it is `false` by default.
- A preview renders at `PREVIEW_SAMPLE_RATE = 24000`, not 48000. This
  halves the payload and loses nothing that matters: `MAX_FREQ_HZ` in
  the contract is 8000, so every oscillator stays below the 12000 Hz
  limit of a 24000 Hz rate. A noise layer does have energy above 12000
  Hz, so a noisy sound previews a little duller than it renders. The
  tool description says so.
- The patch in the same result always describes the full 48000 Hz
  render. The preview never replaces the patch.

## 5. The WAV encoder

New file: `src/library/wav.ts`.

```ts
export function encodeWav(samples: Float32Array, sampleRate?: number): Uint8Array;
```

- Mono, 16-bit signed PCM, little-endian. One `RIFF` header, one `fmt `
  chunk of 16 bytes, one `data` chunk.
- `sampleRate` defaults to `RENDER_SAMPLE_RATE`.
- Each sample is clamped to the range -1 to 1, then scaled. A positive
  sample scales by 32767 and a negative sample by 32768, so the full
  negative range is reachable and no value wraps.
- The result is a `Uint8Array`, not a Node `Buffer`. The library must
  stay usable in a browser.

16-bit is the right depth. The contract holds every sound at or below
-1 dBFS with an RMS between -20 and -14 dBFS, so the quietest part of
the set sits far above the noise floor of 16-bit audio.

The encoder joins the library index, because the web player and later
the site both need it.

## 6. The SDK

New file: `src/sdk.ts`.

```ts
export type SoundOrigin = 'curated' | 'generated';

export type ResolvedSound = {
  patch: Patch;
  origin: SoundOrigin;
  sound?: SoundEntry;   // present when the set answered
  score?: number;       // present when the set answered
};

export type SemanticSoundsOptions = {
  functionUrl?: string;   // the generation endpoint, sub-project 5
  apiKey?: string;        // bearer token for that endpoint
  minScore?: number;      // default LOCAL_MIN_SCORE
  fetchImpl?: typeof fetch; // injected for tests
};

export type SemanticSounds = {
  readonly sounds: readonly SoundEntry[];
  search(query: string, options?: SearchOptions): SoundMatch[];
  find(query: string, options?: SearchOptions): SoundEntry | null;
  get(name: string): SoundEntry | null;
  categories(): string[];
  inCategory(category: string): SoundEntry[];
  render(source: SoundEntry | Patch, sampleRate?: number): Float32Array;
  wav(source: SoundEntry | Patch, sampleRate?: number): Uint8Array;
  durationMs(source: SoundEntry | Patch): number;
  resolve(phrase: string): Promise<ResolvedSound>;
};

export function createSemanticSounds(options?: SemanticSoundsOptions): SemanticSounds;
```

Notes on the surface:

- The index costs time to build over 1090 entries. Build it once, and
  only when the first search asks for it.
- `render` and `wav` accept an entry or a bare patch. A caller who
  holds a generated patch must not have to wrap it in a fake entry.
- `durationMs` is a small helper the MCP server and the site both want.
  It sums the envelope of the longest layer.
- `resolve` returns the curated patch when the top match reaches
  `minScore`. Otherwise it calls `functionUrl`. With no `functionUrl` it
  throws, with a message that names the phrase. The icon SDK behaves the
  same way, and the MCP tool turns the error into plain text.
- `resolve` has no `tooComplex` case. An icon can be too compound to
  draw as one mark. A sound has no matching limit, so the type is not
  copied.

## 7. The MCP server

New files: `src/mcp/server.ts` and `src/mcp/stdio.ts`.

`createServer(sounds?: SemanticSounds): McpServer`. The argument
defaults to `createSemanticSounds(fromEnvironment())`, so a test passes
a fake and drives every tool with no transport and no network.

Five tools:

| Tool | Input | Result |
|---|---|---|
| `search_sounds` | `query`, `limit` (default 5) | One line per match: name, score, phrase, category, duration, keywords. No patches. |
| `get_sound` | `name`, `preview` (default false) | The entry, its concept, the patch as JSON, and a usage snippet. With `preview`, a WAV audio block as well. |
| `list_categories` | none | Every category with its count, and the set total. |
| `list_category` | `category` | Every name and phrase in that category. |
| `resolve_sound` | `phrase`, `preview` (default false) | The best patch for the words, with its origin. |

Rules the tools follow:

- A tool never throws. A failure returns text that says what went wrong
  and which tool to call next. An agent cannot read a stack trace.
- `search_sounds` returns no patches. Patches are large, and a ranked
  list exists so the agent picks one name.
- Every result that carries a patch also carries the usage snippet, so
  the agent sees how `renderPatch` is called and does not invent an API.

`fromEnvironment(env = process.env)` reads three variables:

- `SEMANTIC_SOUNDS_FUNCTION_URL`
- `SEMANTIC_SOUNDS_API_KEY`
- `SEMANTIC_SOUNDS_MIN_SCORE`

`stdio.ts` starts with `#!/usr/bin/env node`. stdout carries the
protocol, so every message it writes goes to stderr.

## 8. Package layout

Root `package.json` gains subpath exports and a bin:

```json
"exports": {
  ".":            { "types": "./dist/index.d.ts",      "import": "./dist/index.js" },
  "./sdk":        { "types": "./dist/sdk.d.ts",        "import": "./dist/sdk.js" },
  "./mcp":        { "types": "./dist/mcp/server.d.ts", "import": "./dist/mcp/server.js" },
  "./mcp/stdio":  { "types": "./dist/mcp/stdio.d.ts",  "import": "./dist/mcp/stdio.js" },
  "./package.json": "./package.json"
},
"bin": { "semantic-sounds-mcp": "./dist/mcp/stdio.js" }
```

The `.` export keeps its current target, `src/library/index.ts`. It
already re-exports the types, the query engine, the renderer, the
validator, and the set. The WAV encoder joins it.

`@modelcontextprotocol/sdk` and `zod` move to `dependencies`. `zod` is a
devDependency today, and the MCP tool schemas need it at run time.

`files` gains `LICENSE` and `README.md`.

New package `packages/semantic-sounds-mcp/`:

- `package.json`, name `semantic-sounds-mcp`, one dependency on
  `semantic-sounds`, one bin pointing at `bin.mjs`.
- `bin.mjs`, which imports `semantic-sounds/mcp/stdio` and nothing else.
- `README.md`.

The wrapper exists for one reason, and the file says it: `npx -y
semantic-sounds-mcp` looks for a package of that name. The bin inside
`semantic-sounds` is invisible to it.

## 9. Testing strategy

Test-driven, colocated, as in every earlier sub-project.

- **`src/library/wav.test.ts`** — header fields at known offsets; byte
  length equals 44 plus twice the sample count; a known ramp round-trips
  through decode; a sample above 1 clamps instead of wrapping; a sample
  of -1 reaches -32768.
- **`src/sdk.test.ts`** — `find` and `get` against real entries;
  `categories` sorted and complete; `render` and `wav` accept an entry
  and a bare patch; `resolve` returns `curated` for a phrase the set
  owns; `resolve` calls the injected `fetchImpl` for a phrase it does
  not own; `resolve` throws a message naming the phrase when no
  `functionUrl` is set; the index builds once across two searches.
- **`src/mcp/server.test.ts`** — drive `createServer` with an
  `InMemoryTransport` pair and a real client from the MCP SDK. Assert
  the tool list, one result per tool, the audio block under `preview`,
  and the plain-text failure for an unknown name and an unknown
  category. `fromEnvironment` gets its own unit tests.

The existing suite must stay green. `npm run sounds:check`, `npm run
probe`, and the typecheck all keep their current results.

## 10. Documentation

- `README.md` gains an SDK section and an MCP section, with the
  `claude mcp add` line.
- `TODO.md` loses the sub-project 4 entry and records what publication
  still needs.
