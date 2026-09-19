import { MIN_FREQ_HZ, MAX_FREQ_HZ, type Layer, type Patch } from './types';

/**
 * Change a patch, rather than change how it plays.
 *
 * A player can shift a sound by playing a buffer faster, but that moves
 * pitch and time together and cannot do one without the other. A patch is
 * data, so the honest way is to write a new patch and render it. Pitch and
 * time then move on their own, and the file a caller downloads is the
 * sound they heard.
 *
 * Every function here returns a new patch. None changes its input.
 */

/** The lowest and highest a filter may be moved to. */
const MIN_CUTOFF_HZ = 20;
const MAX_CUTOFF_HZ = 20000;

/** The limits the site's controls use, and a sane guard for any caller. */
export const MIN_SEMITONES = -24;
export const MAX_SEMITONES = 24;
export const MIN_STRETCH = 0.25;
export const MAX_STRETCH = 4;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Keep a millisecond value readable, and never let it reach zero. */
function ms(value: number): number {
  return Math.max(0, Math.round(value * 100) / 100);
}

/**
 * Move a patch up or down by a number of semitones.
 *
 * Twelve semitones double the frequency. A noise layer has no pitch, so it
 * is left alone, and a sound built on noise changes less than a sound
 * built on a tone. That is correct, not a fault: a hiss has no key.
 *
 * A filter moves with the tone. Leaving the cutoff where it is would keep
 * the same slice of the spectrum as the tone moves under it, and the
 * timbre would drift. Moving it keeps the sound recognisable.
 */
export function transpose(patch: Patch, semitones: number): Patch {
  const steps = clamp(semitones, MIN_SEMITONES, MAX_SEMITONES);
  if (steps === 0) return patch;
  const ratio = Math.pow(2, steps / 12);

  return {
    layers: patch.layers.map((layer): Layer => {
      const source =
        layer.source.type === 'oscillator'
          ? {
              ...layer.source,
              freqHz: clamp(layer.source.freqHz * ratio, MIN_FREQ_HZ, MAX_FREQ_HZ),
              ...(layer.source.pitchEnvelope
                ? {
                    pitchEnvelope: {
                      ...layer.source.pitchEnvelope,
                      toHz: clamp(layer.source.pitchEnvelope.toHz * ratio, MIN_FREQ_HZ, MAX_FREQ_HZ),
                    },
                  }
                : {}),
            }
          : layer.source;

      return {
        ...layer,
        source,
        ...(layer.filter
          ? { filter: { ...layer.filter, cutoffHz: clamp(layer.filter.cutoffHz * ratio, MIN_CUTOFF_HZ, MAX_CUTOFF_HZ) } }
          : {}),
      };
    }),
  };
}

/**
 * Make a patch longer or shorter without moving its pitch.
 *
 * A factor of 2 doubles every envelope stage, so the sound takes twice as
 * long. A factor of 0.5 halves it.
 *
 * The pitch envelope's `timeMs` scales with the rest. A sweep that took a
 * third of the sound must still take a third of it.
 */
export function stretch(patch: Patch, factor: number): Patch {
  const scale = clamp(factor, MIN_STRETCH, MAX_STRETCH);
  if (scale === 1) return patch;

  return {
    layers: patch.layers.map((layer): Layer => {
      const source =
        layer.source.type === 'oscillator' && layer.source.pitchEnvelope
          ? {
              ...layer.source,
              pitchEnvelope: { ...layer.source.pitchEnvelope, timeMs: ms(layer.source.pitchEnvelope.timeMs * scale) },
            }
          : layer.source;

      return {
        ...layer,
        source,
        envelope: {
          ...layer.envelope,
          attackMs: ms(layer.envelope.attackMs * scale),
          decayMs: ms(layer.envelope.decayMs * scale),
          sustainMs: ms(layer.envelope.sustainMs * scale),
          releaseMs: ms(layer.envelope.releaseMs * scale),
        },
      };
    }),
  };
}

/**
 * Scale every layer's gain, and hold the result at or below 1.
 *
 * Above 1 the renderer's peak ceiling would flatten the top of the wave,
 * so a louder request would change the shape and not only the level.
 */
export function amplify(patch: Patch, factor: number): Patch {
  const scale = Math.max(0, factor);
  if (scale === 1) return patch;
  return {
    layers: patch.layers.map((layer) => ({ ...layer, gain: clamp(layer.gain * scale, 0, 1) })),
  };
}

export type Tweak = {
  /** Semitones up or down. 0 leaves the pitch alone. */
  semitones?: number;
  /** A time scale. 1 leaves the length alone, 2 makes it twice as long. */
  stretch?: number;
};

/** Apply a whole set of changes in one call, in a fixed order. */
export function tweak(patch: Patch, options: Tweak): Patch {
  let out = patch;
  if (options.semitones !== undefined) out = transpose(out, options.semitones);
  if (options.stretch !== undefined) out = stretch(out, options.stretch);
  return out;
}

/** True when a set of changes would leave the patch as it is. */
export function isUntweaked(options: Tweak): boolean {
  return (options.semitones ?? 0) === 0 && (options.stretch ?? 1) === 1;
}
