# Sub-project 6: the public static site

Status: approved for planning
Date: 2026-09-19
Author: BirdTempo, with Claude Opus 5

## 1. Goal

Give Semantic Sounds one public page. A person types what they want, hears
it, and takes it away as a patch or as a WAV file.

The page is the first thing a person meets. It must prove the claim in one
minute: a sound is data, not an audio file, and plain prose finds it.

## 2. The one hard difference from an icon site

An icon shows itself. A grid of 3000 icons is useful the moment it loads.

A sound hides. A grid of 1090 names proves nothing, and a page that plays
them to prove it is hostile. So the sound site needs two things an icon
site does not:

- **A waveform on every tile.** It makes a sound visible before anyone
  plays it. The renderer already gives the samples, so the page draws the
  shape itself.
- **Silence until a click.** Nothing plays on load, on hover, or on a
  search. A browser blocks autoplay anyway; that is not the reason. The
  reason is that surprise audio is hostile, and a sound library that
  starts with a noise loses the person in the first second.

## 3. Scope

One page. `site/index.html`, built by a script, with the library inline.

**In scope**

- Prose search over all 1090 sounds, running in the page.
- Result tiles: phrase, category, duration, waveform, play, copy patch,
  download WAV.
- Browse by category: 26 filters.
- An install section: npm, the SDK, and the MCP line.
- `robots.txt`, `sitemap.xml`, `llms.txt`, `_headers`, a favicon.
- A Cloudflare Pages deploy target.

**Out of scope**

- A blog. The icon project has one; this project does not need one to
  ship a set.
- An edge worker. The site has no dynamic route, so it needs none.
- Generation from the page. That is sub-project 5, and it needs a key.
- A domain purchase. Section 9.

## 4. Page weight

Measured, not guessed. `esbuild --bundle --minify` over `src/sdk.ts`,
which pulls in the query engine, the renderer, the WAV encoder and every
patch:

| | Size |
|---|---|
| Raw | 535 KB |
| Gzipped | **89 KB** |

89 KB carries the whole set and its search. That is small enough to
inline, so the page needs no second request and no loading state. The
build inlines it.

## 5. What the page does

**On load.** Nothing renders audio. The page shows the hero, the search
box, the category filters, and the first tiles of the full set.

**On a keystroke.** The query runs in memory. Results replace the tiles.
An empty box shows the whole set again.

**On a tile becoming visible.** An `IntersectionObserver` renders that one
patch and draws its waveform. The review tool already uses this pattern
for the same reason: 1090 renders at load would freeze the page, and a
person sees about twelve tiles at a time.

**On a click.** One `AudioContext`, created on the first click and reused.
The patch renders, it plays once, and the tile shows a moving playhead.

**On copy.** The patch, as pretty JSON, to the clipboard.

**On download.** `encodeWav` gives the bytes, a blob URL gives the file,
named after the sound.

## 6. Tile design

```
┌──────────────────────────────────────┐
│  ∿∿∿∿  (waveform, click to play)     │
│  upload complete                     │
│  ui-feedback · 151 ms · 2 layers     │
│  [ copy patch ]  [ .wav ]            │
└──────────────────────────────────────┘
```

The waveform is an inline SVG polyline over about 200 points, taken as
the peak of each bucket of samples. A peak envelope, not an average: an
average flattens a short transient to nothing, and a transient is exactly
what most of this set is.

## 7. Accessibility and respect

- Every tile is a real `button`. The keyboard reaches it, and Enter plays
  it.
- The waveform carries `aria-hidden`, because the name beside it already
  says what the sound is.
- A volume control and a mute switch sit at the top and persist in
  `localStorage`. A person who lands on a sound site with headphones on
  must be able to turn it down before the first click.
- `prefers-reduced-motion` stops the playhead. The sound still plays.
- The page works with no JavaScript only as far as the text. That is
  honest: the whole point is synthesis in the page, and a page that
  cannot run code cannot make a sound.

## 8. Files

```
scripts/build-site.ts     the generator
site/index.html           generated, git-ignored
site/_headers             security and cache rules
site/robots.txt           written by hand
site/sitemap.xml          generated
site/llms.txt             generated: the set as plain text for a reader
site/favicon.svg          written by hand
wrangler.toml             the Pages project
```

`site/index.html` is generated, so it is git-ignored, exactly as `dist/`
is. The build script and the static files are committed.

`llms.txt` lists every sound as `name — phrase — category — keywords`. An
agent that cannot run the MCP server can still read the set.

## 9. The domain

`semantic-sounds.com`. The author owns it already, so nothing is
bought here.

The build takes one `ORIGIN` constant, and `sitemap.xml`, the canonical
link and the Open Graph tags all read it. `robots.txt` is written by
hand and holds the origin literally.

The deploy step stays manual. A deploy is outward-facing, so it needs
the author's word.

## 10. Testing strategy

A generated page needs a test that reads the output, not the generator.

**`scripts/build-site.test.ts`**

- The page holds every sound name, so nothing is silently dropped.
- The page holds the inline bundle, and the bundle holds `renderPatch`.
- The page holds no `<script src=` pointing at another host, so the
  Content-Security-Policy in `_headers` is true.
- Every category appears as a filter.
- The canonical link, the Open Graph URL and the sitemap all use one
  origin, and it is the `ORIGIN` constant.
- `llms.txt` has one line per sound.
- The page has no `autoplay` attribute and no call that starts audio
  outside a click handler.

The existing suite keeps its results: 152 tests, clean typecheck, 1090
entries with 0 problems, 98 of 104 probe cases.
