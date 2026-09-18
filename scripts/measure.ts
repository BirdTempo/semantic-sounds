#!/usr/bin/env -S npx tsx
// Usage: npx tsx scripts/measure.ts path/to/file.json [name ...]
//
// Print what the renderer actually produces for each entry: duration,
// peak, loudness, DC offset, brightness, pitch direction and attack.
// The validator reads the same numbers. Use this to tune `gain` and the
// envelope before you guess.
import { readFileSync } from 'node:fs';
import { renderPatch } from '../src/library/render';
import { computeDescriptors, RMS_MAX_DB, RMS_MIN_DB, PEAK_CEILING } from '../src/library/validate';
import { RENDER_SAMPLE_RATE, type SoundEntry } from '../src/library/types';

const [file, ...only] = process.argv.slice(2);
if (!file) {
  console.error('usage: npx tsx scripts/measure.ts path/to/file.json [name ...]');
  process.exit(1);
}

const entries: SoundEntry[] = JSON.parse(readFileSync(file, 'utf8'));
const wanted = only.length > 0 ? new Set(only) : null;

console.log(
  ['name', 'ms', 'peak', 'rmsDb', 'dc', 'brightHz', 'pitch', 'attack'].map((h) => h.padEnd(9)).join('') + 'verdict',
);
for (const entry of entries) {
  if (wanted && !wanted.has(entry.name)) continue;
  const d = computeDescriptors(renderPatch(entry.patch, RENDER_SAMPLE_RATE), RENDER_SAMPLE_RATE);
  const loud = d.rmsDb < RMS_MIN_DB ? 'too quiet' : d.rmsDb > RMS_MAX_DB ? 'too loud' : 'ok';
  const verdict = d.peak > PEAK_CEILING ? 'peak over' : loud;
  console.log(
    [
      entry.name.slice(0, 8),
      d.durationMs.toFixed(0),
      d.peak.toFixed(3),
      d.rmsDb.toFixed(1),
      d.dcOffset.toFixed(4),
      d.brightnessHz.toFixed(0),
      d.pitchDirection,
      d.attack,
    ]
      .map((v) => String(v).padEnd(9))
      .join('') + verdict,
  );
}
