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
