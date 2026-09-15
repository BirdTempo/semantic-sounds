# Sound style guide

Every sound in Semantic Sounds follows this guide. It has hard rules the
validator enforces, and soft rules for judgment.

## Sonic style

Soft and rounded synth. Sine and triangle tones, gentle attacks, gentle
low-pass filtering. Warm and unobtrusive, in the register of macOS/iOS
system sounds. Avoid harsh square/saw waves as a primary tone; use them
only as a secondary texture layer, filtered down.

## Hard rules (the validator enforces these)

- Duration: 30ms to 1500ms.
- Layers: 1 to 4.
- Peak: at or below -1 dBFS (0.891 linear). The renderer already limits
  this; do not fight it with extreme gain values.
- Loudness: RMS between -20 and -14 dBFS. If your sound reads as too
  quiet or too loud once rendered, adjust `gain` and `sustainLevel`, not
  the contract.
- No DC offset: a symmetrical waveform. Oscillators and the noise
  generator already produce this; do not add a constant offset.
- No click: the renderer fades the first and last 3ms automatically. Do
  not rely on your own envelope to reach exactly zero at the edges.
- Metadata: `name` and `category` are kebab-case. `concept` is at least
  20 characters. At least 4 keywords. No duplicate `name` or `phrase`
  across the library.
- Concept agreement: if `concept` uses a word like "rising", "falling",
  "soft"/"gentle", "sharp"/"percussive", "bright", "dark"/"warm",
  "short"/"quick", or "long"/"sustained", the patch must actually
  produce that. A pitch sweep needs a `pitchEnvelope`; a claimed soft
  attack needs `attackMs` to be a real fraction of the sound's total
  duration (roughly 8% or more), not a near-instant transient; a
  claimed short sound needs a duration under 200ms, a claimed long one
  over 800ms. The validator checks this because a model cannot hear its
  own output.

## Soft rules (judgment, not machine-checked)

- Register: aim for a shared middle register across the set (roughly
  200-1000 Hz for tone layers) so sounds feel related when played one
  after another. This is a guideline, not a validator rule.
- Attack character: match the chosen sonic style. A "sharp" attack
  should still feel soft-edged, not harsh, at this style's level.
- Per-layer purpose: a tone layer (oscillator) carries pitch identity;
  a noise layer carries texture or a transient (a click, a whoosh).
  Don't use noise as the only layer for a sound whose concept is about
  pitch.
- Recognizability: with the name covered, would a listener guess the
  intended feeling (success, error, urgency, calm) from the sound
  alone? If not, the envelope or pitch choice likely needs to be more
  distinct, not louder.

## Entry format

```json
{
  "name": "success-chime",
  "phrase": "success chime",
  "category": "ui-feedback",
  "concept": "A short, soft, rising chime for a completed action.",
  "keywords": ["success", "done", "complete", "confirm", "checkmark", "saved", "finished"],
  "patch": {
    "layers": [
      {
        "source": { "type": "oscillator", "wave": "sine", "freqHz": 500, "pitchEnvelope": { "toHz": 900, "timeMs": 90 } },
        "envelope": { "attackMs": 15, "decayMs": 40, "sustainLevel": 0.3, "sustainMs": 40, "releaseMs": 60 },
        "gain": 0.6
      }
    ]
  }
}
```

The 15ms attack (about 10% of this sound's 155ms total duration) is
what earns the "soft" claim in the concept above; a 2-4ms attack on the
same sound would read as sharp and fail the concept-agreement check.

## Keyword-writing guidance

Same discipline as the icon set's keywords, because the same query
engine (`src/library/query.ts`) reads them:

- Write 5-10 keywords: synonyms, related product words, and phrases a
  caller would actually type ("the upload finished", not just
  "upload").
- Don't repeat the phrase itself; it is already indexed.
- Don't add plurals or verb tenses; the stemmer handles those
  (`stem('running') === 'run'`).
- Name the sound's own subject, not a scene around it. A game "coin
  pickup" sound should list "coin", "pickup", "collect" — not "game"
  or "screen", which would steal queries meant for other entries.
- Keep every keyword lowercase and trimmed; the validator rejects
  anything else.

## Common failures

| Symptom | Fix |
|---|---|
| Validator says "duration out of range" | Check every layer's `attackMs+decayMs+sustainMs+releaseMs`; the patch's duration is the longest of these. |
| Validator says "loudness ... outside target window" | Raise or lower `gain`/`sustainLevel`, not the contract constants. |
| Validator says "concept mentions ... but the patch does not produce ..." | Either change the wording in `concept`, or add/adjust a `pitchEnvelope` (for rising/falling), lengthen `attackMs` relative to total duration (for soft), or shorten/lengthen the envelope (for short/long). |
| Sound is hard to identify blind | Give the tone layer a more distinct pitch or pitch movement; don't just raise the volume. |
