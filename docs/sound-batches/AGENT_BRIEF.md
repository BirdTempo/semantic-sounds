# Sound batch authoring brief

You are authoring one category batch of the Semantic Sounds seed set.

1. Read `docs/sound-style-guide.md` in full before writing anything.
2. Read your batch file under `docs/sound-batches/<category>.json`. It
   lists the `name`, `phrase`, and `outputFile` for every sound in your
   batch. Write one entry per phrase.
3. Each entry needs: `name`, `phrase`, `category` (from the batch
   file), `concept` (>= 20 characters, matching the style guide's
   concept-agreement rules), `keywords` (>= 4, following the
   keyword-writing guidance), and `patch` (1-4 layers, following the
   entry format example).
4. Write your batch's `outputFile` as a JSON array of entries as soon
   as every entry in it passes `npx tsx scripts/check-library.ts
   <outputFile>` with zero problems. The checker prints every problem
   for every entry; fix all of them, don't stop at the first.
   Write the file the moment it fully passes, then keep refining only
   by re-writing the same file — a parent process can stop you at any
   time, and only a written file survives that.
5. Expect to redraw (rewrite the patch for) about a third of your
   entries after first hearing them. A batch with no rewrites means
   you judged too kindly the first time — actually render and reason
   through what each patch sounds like (attack speed, pitch movement,
   layer balance) before accepting it.
6. If a phrase genuinely cannot be made distinct and pass the contract
   after real effort, report it back rather than shipping something
   that doesn't work. Say which phrase and why.
7. Only touch your own `outputFile`. Do not edit the style guide, the
   validator, other batches' output files, or run git commands.
8. Report back: the output file path, how many entries you wrote, and
   any phrase you could not make work.
