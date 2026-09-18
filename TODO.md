# TODO

Deferred work and decisions, with reasons. Update this file rather than
letting deferred work rot into an undocumented gap.

## Deferred to later sub-projects

- The review tool with play buttons (sub-project 2).
- The full 300-500 sound set, built by parallel agents from
  `docs/sound-batches/AGENT_BRIEF.md` at a larger scale (sub-project 3).
  A "must not regress" band should be added to `scripts/prose-probe.ts`
  once that set ships.
- The SDK, MCP server, and the `semantic-sounds-mcp` wrapper package
  (sub-project 4). `npm view semantic-sounds` and `npm view
  semantic-sounds-mcp` were both free on 2026-09-15. Publishing target:
  the BirdTempo GitHub and npm orgs.
- Generation for a miss, using `claude-opus-5` through structured
  outputs, checked by `checkEntry` (sub-project 5).
- The public static site (sub-project 6).

## Open technical follow-ups

- `LOCAL_MIN_SCORE` (currently 9) was grid-searched against a 48-case
  probe covering only the 40-sound seed set. Re-run
  `scripts/tune-thresholds.ts` whenever the corpus grows meaningfully;
  do not assume the value is stable at a larger scale.
- One probe case is a documented, accepted word-trap, not a bug: "on"
  is kept as a content word (needed for "toggle on"/"toggle off"), so
  an unrelated sentence using "on" as a preposition ("the smell of
  rain on hot pavement") can still score above the floor. No single
  floor separates every true positive from this trap given the current
  40-sound corpus; revisit if a larger corpus changes the balance.
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
