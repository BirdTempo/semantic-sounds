# Sound batch authoring brief

You author one batch of the Semantic Sounds library. Work only in the
repository root `/Users/admin/Documents/code/semantic-sounds`.

## Steps

1. Read `docs/sound-style-guide.md` in full before you write anything.
2. Read your batch file, `docs/sound-batches/batches/batch-NN.json`. It
   gives the `category`, the `outputFile`, and the `name` and `phrase` of
   every sound in your batch. Write one entry per phrase. Do not add,
   drop, or rename a phrase.
3. Each entry needs `name`, `phrase`, `category` (all from the batch
   file), `concept`, `keywords`, and `patch`:
   - `concept`: 20 characters or more. It must describe the sound you
     actually built. See "Concept agreement" below.
   - `keywords`: 5 to 10, lowercase, no duplicates, no plurals. Name the
     sound's own subject, not the scene around it.
   - `patch`: 1 to 4 layers. Follow the entry format in the style guide.
4. Write `outputFile` as a JSON array of entries. Validate with:

   ```bash
   npx tsx scripts/check-library.ts <outputFile>
   ```

   Fix every problem it reports, not just the first. The file is done
   when it prints `0 problems found`.
5. Use the measure tool to tune loudness and duration without guessing:

   ```bash
   npx tsx scripts/measure.ts <outputFile>
   ```

   It prints the real duration, peak, loudness, brightness, pitch
   direction and attack for every entry.
6. Write the file as soon as every entry passes. Then keep improving it
   by rewriting the same file. A parent process can stop you at any
   time, and only a written file survives that.

## Hitting the contract on the first try

Most first drafts fail on loudness. Start from these and adjust:

- One sine layer, `gain` 0.6, a 120-200ms envelope lands near -15 dBFS.
- Two layers at `gain` 0.45 each land in about the same place.
- Loudness is RMS over the whole sound. A long quiet tail pulls RMS
  down, so a long sound needs more `gain` than a short one, not less.
- If `measure` says "too quiet", raise `gain` and `sustainLevel`. If it
  says "too loud", lower them. Never change the contract constants.

## Known traps

These cost the first authors the most time. Read them before you draft.

- **Very short sounds fight the fade.** The renderer fades the first and
  last 3ms. Below about 45ms total, that fade moves the measured peak
  and can break a "sharp" claim. Keep a transient at 45-80ms. Never go
  below the 30ms hard minimum.
- **A low tone in a short sound reads as DC offset.** A 200 Hz tone
  needs 5ms for one cycle. In a 40ms sound it completes too few cycles
  to average to zero, and the check fails. Raise the frequency, or make
  the sound longer, or add a highpass filter.
- **A filtered noise layer is much quieter than it looks.** A lowpass or
  bandpass takes out most of the energy. A noise texture often needs
  `gain` and `sustainLevel` near 1.0 to reach the loudness window. One
  lowpass stage passes more than a bandpass.
- **A noise transient can measure "soft" with a 2ms attack.** The true
  peak of a noise burst can land after the attack window. Add a short
  plateau (`sustainMs` 5-8 at `sustainLevel` about 0.2) to hold the peak
  inside the first 8% of the sound.
- **A long tail pulls loudness down.** RMS covers the whole sound. A
  1000ms sound with a quiet tail needs more `gain` than a 100ms one.
- **Noise hides pitch direction.** The validator reads pitch direction
  from the zero-crossing rate of the whole mix. Noise crosses zero far
  more often than a tone, and the count ignores amplitude. Even a quiet
  noise layer can flip or erase a "rising" or "falling" claim. On any
  entry with a direction claim, keep the noise layer's `gain` at 0.15 or
  less, end it before the last third, or use a second oscillator with
  the same `pitchEnvelope` instead.
- **"Dark" and "warm" are hard to earn.** The filters are one-pole and
  roll off only 6 dB per octave, so a lowpass at 400 Hz still leaves
  energy above the 1500 Hz brightness line. A plain triangle wave also
  measures about 3x its own frequency. Expect to drop the word rather
  than to fight the filter.
- **A highpass, not a bandpass, makes a loud sharp noise click.** A
  working shape: `attackMs` 2, `decayMs` 15, `sustainLevel` 0.2,
  `sustainMs` 5, `releaseMs` 15, highpass near 4000 Hz, `gain` 0.75.
- **The concept check matches inside words.** "quickly" contains
  "quick", so it triggers the short-duration rule. Read your concept for
  an accidental match before you change the patch.
- **The patch model has no repeated modulation.** There is one ADSR and
  one linear pitch ramp per layer. To make a beat or a wobble, detune
  two layers a little, or give two layers opposite pitch ramps.
- **Two sounds can both pass and still be wrong.** Vary the pitch
  movement, attack, layer count and duration across your batch.

Work in passes: draft every entry, run `measure` once, then fix in bulk.
That is faster than one entry at a time.

## Concept agreement

The validator renders your patch and compares it with your words. If
your `concept` says:

- "rising" or "falling": the patch needs a `pitchEnvelope` that moves
  that way.
- "soft" or "gentle": `attackMs` must be about 8% or more of the total
  duration.
- "sharp" or "percussive": `attackMs` must be well under that.
- "short" or "quick": total duration under 200ms.
- "long" or "sustained": total duration over 800ms.
- "bright": the measured brightness must be high; "dark" or "warm": low.

Either build what you claim, or change the claim. Both are correct
fixes.

## Style

The set has one voice: soft, rounded, warm, in the register of system
sounds. Sine and triangle carry pitch. Use square or saw only as a
filtered secondary texture, never as the main tone. Keep tone layers
roughly in 200-1000 Hz so the whole library sits together.

Inside that voice, make each sound in your batch distinct from its
neighbours. Two entries with the same envelope and a 20 Hz pitch
difference are a failure even when both pass the validator. Vary the
pitch movement, the attack, the layer count, and the duration.

## Rules

- Touch only your own `outputFile`. Do not edit the style guide, the
  validator, the batch files, another batch's output, or any script.
- Do not run any git command.
- Do not run `npm run sounds:build`, `npm test`, or the review tool.
- If a phrase truly cannot be made to work after real effort, leave it
  out of the file and report it. A missing entry is better than a bad
  one.

## Report back

Give the output file path, how many entries you wrote, and any phrase
you could not make work with the reason.
