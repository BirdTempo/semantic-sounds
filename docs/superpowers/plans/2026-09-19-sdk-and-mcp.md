# SDK and MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 1090-sound set usable from outside this repository, through a WAV encoder, one SDK object, and an MCP server.

**Architecture:** Three layers stack on the existing library. `wav.ts` turns a `Float32Array` into a file. `sdk.ts` holds the index, the renderer, and the encoder behind one factory. `mcp/server.ts` wraps the SDK in five tools and takes the SDK as an argument, so a test drives it with no transport.

**Tech Stack:** TypeScript strict with `noUncheckedIndexedAccess`, ESM, Vitest, tsup, `@modelcontextprotocol/sdk`, `zod`.

**Spec:** `docs/superpowers/specs/2026-09-19-sdk-and-mcp-design.md`

## Global Constraints

- Author `BirdTempo`, license MIT.
- Package names `semantic-sounds` and `semantic-sounds-mcp`, both unscoped. Both confirmed free on npm on 2026-09-19.
- All prose in Simplified Technical English.
- `RENDER_SAMPLE_RATE = 48000`, exported from `src/library/types.ts`.
- `PREVIEW_SAMPLE_RATE = 24000`, new, exported from `src/mcp/server.ts`.
- Never run `npm publish`. Publication stays a manual step for the author.
- Every existing check keeps its result: 99 tests, clean typecheck, 1090 entries with 0 contract problems, 98 of 104 probe cases.

---

### Task 1: WAV encoder

**Files:**
- Create: `src/library/wav.ts`
- Create: `src/library/wav.test.ts`
- Modify: `src/library/index.ts`

**Interfaces:**
- Consumes: `RENDER_SAMPLE_RATE` from `./types`.
- Produces: `encodeWav(samples: Float32Array, sampleRate?: number): Uint8Array`. Task 2 calls it. The web player and the site may call it later.

- [ ] **Step 1: Write the failing tests**

Cover: the `RIFF`/`WAVE`/`fmt `/`data` tags at offsets 0, 8, 12 and 36; `byteLength === 44 + 2 * samples.length`; channel count 1, the sample rate, byte rate `rate * 2`, block align 2, bit depth 16; a ramp read back through a `DataView` matches the input inside one step of 16-bit resolution; `1.5` clamps to 32767; `-1` reaches -32768; an empty input gives a 44-byte header.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/library/wav.test.ts`
Expected: FAIL, no such module.

- [ ] **Step 3: Write the encoder**

Mono, 16-bit signed PCM, little-endian. Clamp to -1..1. Scale a positive sample by 32767 and a negative sample by 32768, so the full negative range is reachable and no value wraps.

- [ ] **Step 4: Run the tests and confirm they pass**

- [ ] **Step 5: Export it and commit**

Add `export * from './wav';` to `src/library/index.ts`. Run `npm test` and `npm run typecheck`. Commit.

---

### Task 2: The SDK

**Files:**
- Create: `src/sdk.ts`
- Create: `src/sdk.test.ts`

**Interfaces:**
- Consumes: `sounds`, `createSoundIndex`, `searchIndex`, `LOCAL_MIN_SCORE`, `renderPatch`, `encodeWav`, and the types, all from `./library/index.js`.
- Produces: `createSemanticSounds(options?): SemanticSounds`, plus the types `SemanticSounds`, `SemanticSoundsOptions`, `ResolvedSound`, `SoundOrigin`. Task 3 consumes all of them.

The full surface is in section 6 of the spec. Copy it exactly.

- [ ] **Step 1: Write the failing tests**

Cover: `sounds.length >= 1000`; `find('the file finished uploading')` returns the entry named `upload-complete`; `get` on a real name and on nonsense; `categories()` sorted, unique, and holding `ui-feedback`; `inCategory` non-empty for every category name; `render` accepts an entry and a bare patch and gives a non-empty `Float32Array`; `wav` gives bytes starting with `RIFF`; `durationMs` agrees with the render length inside 1 ms; `resolve` on an owned phrase gives `origin: 'curated'` with a `sound` and a `score`; `resolve` on `'quantum entanglement'` with an injected `fetchImpl` calls that fetch once with the phrase in the body and gives `origin: 'generated'`; the same call with no `functionUrl` rejects with a message holding the phrase; two searches build the index once (count the calls by timing is wrong -- instead assert a second search returns the same array contents and that a spy on the index factory is not available, so assert only that two searches agree).

**Note on the index-built-once test:** do not spy on the module. Instead export nothing extra. Assert the behaviour that matters: two searches for the same query give equal results. The single build is an implementation detail held by the `??=` in the factory.

- [ ] **Step 2: Run the tests and confirm they fail**

- [ ] **Step 3: Write the SDK**

- [ ] **Step 4: Run the tests and confirm they pass**

- [ ] **Step 5: Run the whole suite, typecheck, and commit**

---

### Task 3: The MCP server

**Files:**
- Create: `src/mcp/server.ts`
- Create: `src/mcp/server.test.ts`
- Modify: `package.json` (move `zod` to `dependencies`, add `@modelcontextprotocol/sdk`)

**Interfaces:**
- Consumes: `createSemanticSounds`, `SemanticSounds` from `../sdk.js`.
- Produces: `createServer(sounds?: SemanticSounds): McpServer`, `fromEnvironment(env?): SemanticSoundsOptions`, `SERVER_NAME`, `SERVER_VERSION`, `PREVIEW_SAMPLE_RATE`. Task 4 consumes `createServer`.

- [ ] **Step 1: Install the MCP SDK**

Run: `npm install @modelcontextprotocol/sdk@^1.30.0` and move `zod` from `devDependencies` to `dependencies`.

- [ ] **Step 2: Write the failing tests**

Drive the server through an `InMemoryTransport` pair and a real `Client` from `@modelcontextprotocol/sdk/client/index.js`.

Cover: `listTools` gives exactly the five names; `search_sounds` on `'the file finished uploading'` returns text holding `upload-complete`; `search_sounds` on nonsense returns the "no sound matched" line, not an error; `get_sound` on a real name returns the patch JSON and the usage snippet, and `content` holds no audio block; `get_sound` with `preview: true` adds one block of `type: 'audio'` with `mimeType: 'audio/wav'` and non-empty base64; `get_sound` on an unknown name returns text naming the tool to call next and `isError` is not set; `list_categories` reports 26 categories and 1090 sounds; `list_category` on a real name and on an unknown one; `resolve_sound` on an owned phrase reports `curated`; `resolve_sound` with no function URL on nonsense returns the plain-text "not configured" message rather than throwing.

`fromEnvironment` gets plain unit tests: an empty environment gives `{}`; each variable maps to its option; a non-numeric or negative `SEMANTIC_SOUNDS_MIN_SCORE` is ignored.

- [ ] **Step 3: Run the tests and confirm they fail**

- [ ] **Step 4: Write the server**

Five tools, as in section 7 of the spec. A tool never throws: catch and return text. `search_sounds` returns no patches.

The usage snippet, shared by `get_sound` and `resolve_sound`:

```
import { renderPatch } from 'semantic-sounds';
const samples = renderPatch(patch);   // Float32Array at 48000 Hz
```

- [ ] **Step 5: Run the tests and confirm they pass**

- [ ] **Step 6: Run the whole suite, typecheck, and commit**

---

### Task 4: The stdio entry, the package exports, and the wrapper package

**Files:**
- Create: `src/mcp/stdio.ts`
- Create: `packages/semantic-sounds-mcp/package.json`
- Create: `packages/semantic-sounds-mcp/bin.mjs`
- Create: `packages/semantic-sounds-mcp/README.md`
- Modify: `package.json` (`exports`, `bin`, `files`, `build` script)

**Interfaces:**
- Consumes: `createServer` from `./server.js`.
- Produces: the `semantic-sounds-mcp` binary.

- [ ] **Step 1: Write `src/mcp/stdio.ts`**

`#!/usr/bin/env node`, connect `createServer()` to a `StdioServerTransport`, and send every message to stderr, because stdout carries the protocol.

- [ ] **Step 2: Widen the build and the exports**

`build` becomes:

```
tsup src/library/index.ts src/sdk.ts src/mcp/server.ts src/mcp/stdio.ts --format esm --dts --clean --out-dir dist
```

Add the four `exports` entries and the `bin` from section 8 of the spec. Add `LICENSE` and `README.md` to `files`.

- [ ] **Step 3: Run the build and confirm the four entry points exist**

Run: `npm run build && ls dist dist/mcp`
Expected: `index.js`, `sdk.js`, `mcp/server.js`, `mcp/stdio.js`, and a `.d.ts` beside each.

- [ ] **Step 4: Start the built server over stdio and confirm it answers**

Pipe one `initialize` request and one `tools/list` request into `node dist/mcp/stdio.js` and confirm the five tool names come back. This is the check that the bin path, the shebang, and the dependency list all agree.

- [ ] **Step 5: Write the wrapper package**

Copy the shape of `packages/semantic-icons-mcp/` in the reference project. `bin.mjs` imports `semantic-sounds/mcp/stdio` and holds the comment that says why the package exists.

- [ ] **Step 6: Commit**

---

### Task 5: Documentation

**Files:**
- Modify: `README.md`
- Modify: `TODO.md`

- [ ] **Step 1: Add the SDK section and the MCP section to `README.md`**

Show `createSemanticSounds`, `resolve`, and `wav`. Show the `claude mcp add semantic-sounds -- npx -y semantic-sounds-mcp` line and name the five tools.

- [ ] **Step 2: Update `TODO.md`**

Remove the sub-project 4 entry. Record what publication still needs, and that `npm publish` is deliberately not run.

- [ ] **Step 3: Run every check and commit**

Run: `npm test`, `npm run typecheck`, `npm run sounds:check`, `npm run probe`, `npm run build`.
