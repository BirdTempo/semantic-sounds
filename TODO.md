# TODO

Deferred work and decisions, with reasons. Update this file rather than
letting deferred work rot into an undocumented gap.

## Deferred to later sub-projects

- The SDK, MCP server, and the `semantic-sounds-mcp` wrapper package
  (sub-project 4). `npm view semantic-sounds` and `npm view
  semantic-sounds-mcp` were both free on 2026-09-15. Publishing target:
  the BirdTempo GitHub and npm orgs.
- Generation for a miss, using `claude-opus-5` through structured
  outputs, checked by `checkEntry` (sub-project 5).
- The public static site (sub-project 6).

## Retrieval at 1090 sounds

The probe grew from 48 cases to 104 and now covers every category. 98
pass. The six that do not are listed in `scripts/prose-probe.ts` with
their cause, and the count is the regression baseline.

Three findings from the growth to 1090 sounds:

- **The stemmer was the largest single defect.** "purring" did not reach
  "purr", and "sneezed" did not reach "sneeze". Porter's undoubling ran
  only after a suffix came off, and the restore-e step was missing. Both
  are fixed and symmetric now. At 40 sounds the fault was invisible,
  because no two entries competed closely enough for it to matter.
- **Keyword data limits recall, not the scorer.** Independent authors
  gave entries a sibling's subject as a keyword. `scripts/prune-stolen-
  keywords.ts` finds and removes that class. Entries also lacked the
  natural phrasing a caller types ("washing machine" for "washer done").
- **The remaining misses need meaning, not weights.** An entry named
  "password wrong" owns the word "wrong"; "moment" is rarer than "calm".
  No global weighting fixes these without demoting phrase matches
  everywhere. They are recorded, not fought.

The threshold search was re-run at this size. The plateau is 5 to 30,
so `LOCAL_MIN_SCORE = 9` is unchanged and still has margin.

## Open technical follow-ups

- `LOCAL_MIN_SCORE` was re-searched at 1090 sounds (see above). Re-run
  `scripts/tune-thresholds.ts` whenever the corpus grows meaningfully.
- The shared tonal centre is a soft guideline in the style guide, not a
  validator rule. If sounds don't sit well back-to-back in practice,
  consider promoting it to a machine check, but only with evidence from
  actual listening.
- Filters are one-pole. Revisit if the soft style rules ever need a
  steeper slope than a one-pole filter can give.
- `MAX_LAYERS = 4` came from a performance check on a 1s/4-layer patch.
  Raise it only after re-running that check.
- The renderer's performance test compares against a naive per-sample
  implementation run back to back, and asserts a ratio, rather than a
  wall-clock budget. An absolute budget was tried first and was not
  workable: on a loaded shared machine the real renderer's median for
  the test patch ranges from about 5ms to 12ms, which overlaps what the
  naive version measures on an idle one, so the test was measuring the
  machine instead of the code. The ratio cancels load out, because load
  scales both implementations together. Measured margin: about 3.7x
  against a threshold of 2x.
- The review tool reviews by ear, one sound at a time. If reviewing 500
  sounds proves slow, consider a "play all in category" sweep -- but only
  with evidence from real use.
- The review tool generates with `claude-opus-5` at effort `high`. The icon
  project found Opus and Sonnet mixed on quality; if cost becomes a problem,
  generate slot A with Opus and B/C with Sonnet, and let the ear decide.
- A compound word in a phrase is unreachable from its two-word query
  form: "snowfall" cannot be found by "snow falling" through the index
  alone. Both entries carry the split form as a keyword instead. A
  general fix needs a compound dictionary; revisit only if more of the
  set hits it.
- `scripts/review/rejected.jsonl` is append-only and committed on purpose: it
  is the memory that stops a later round from repeating a rejected idea.
  Never rewrite it to tidy it up.

## Bugs found and fixed during the seed-set build

Recorded here because three independent batch-authoring agents each
hit the same underlying bugs on unrelated patches -- exactly the kind
of signal worth keeping, per the icon project's own TODO.md practice
of writing down *why*, not just *what*:

- **Spectral-centroid aliasing (fixed):** the original `spectralCentroid`
  summed a partial DFT over only every Nth sample once a render crossed
  4096 samples, a decimation with no anti-alias prefilter. It folded
  high-frequency envelope/filter-edge energy down into low bins, so any
  patch longer than ~170ms could read as spuriously "bright" (several
  kHz) regardless of its real pitch. Replaced with a full radix-2 FFT
  over the zero-padded signal.
- **Residual DC bias (fixed):** multiplying a zero-mean signal (an
  oscillator cycle, generated noise) by a time-varying envelope does
  not generally preserve zero mean. Agents hit this as a DC-offset
  contract failure on both a plain low sine and a filtered pink-noise
  layer. Now removed once, on the final mix, in `renderPatch`.
