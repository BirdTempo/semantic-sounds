import { RENDER_SAMPLE_RATE, type HapticPreset, type Patch, type SoundEntry } from './types';
import { renderPatch } from './render';
import { computeDescriptors } from './validate';
import { terms } from './normalize';

/**
 * A sound and a vibration are the same gesture.
 *
 * On a phone set to vibrate, the haptic *is* the notification. Both are an
 * envelope over time, so a haptic does not need its own authored set: it
 * is derived from the patch that already exists.
 *
 * Two levels come out, because the platforms are not equal:
 *
 * - `steps`, a real envelope, for Android `VibrationEffect.createWaveform`
 *   and iOS Core Haptics.
 * - `preset`, one of nine standard names, for `expo-haptics`, which offers
 *   presets and nothing else. Checked against expo-haptics 57.
 */

/** One piece of an envelope. `intensity` runs 0 to 1. */
export type HapticStep = { durationMs: number; intensity: number };

/**
 * The standard presets. Declared in types.ts, re-exported here so a caller
 * who imports only this module gets the whole vocabulary.
 *
 * The six shape presets come from the audio alone. The three notification
 * presets carry meaning, which audio cannot supply, so only `hapticFor`
 * chooses them, from the entry's own words.
 */
export type { HapticPreset };

export type HapticPattern = {
  /** The envelope, trimmed and merged. */
  steps: HapticStep[];
  /** The total length of `steps`. */
  durationMs: number;
  /** The closest standard preset. */
  preset: HapticPreset;
  /** How many separate knocks a person feels. */
  pulses: number;
  /**
   * How crisp it should feel, 0 to 1, for iOS Core Haptics.
   *
   * Taken from the spectral centroid: a bright sound is a sharp tap, and a
   * dark one is a dull thud. That is the same judgement a person makes by
   * ear, and the descriptor is already computed for the contract.
   */
  sharpness: number;
};

export type HapticOptions = {
  /** The length of one step. Hardware cannot do much below 10ms. */
  stepMs?: number;
  /** Cut the pattern here. A vibration that outlasts its sound is noise. */
  maxMs?: number;
  /** Below this a motor does nothing, so it counts as silence. */
  floor?: number;
};

export const HAPTIC_STEP_MS = 10;
export const HAPTIC_MAX_MS = 1000;
export const HAPTIC_FLOOR = 0.08;

/** Two steps this close feel the same, so they are merged. */
const MERGE_TOLERANCE = 0.08;

/** A knock starts above this and ends below the floor. */
const PULSE_ON = 0.5;
const PULSE_OFF = 0.25;

/** A bright sound is a sharp tap. 4000 Hz reads as fully sharp. */
const FULL_SHARPNESS_HZ = 4000;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** The peak of every window. A peak, never an average: see `wavePath`. */
function envelope(samples: Float32Array, samplesPerStep: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < samples.length; i += samplesPerStep) {
    let peak = 0;
    for (let j = i; j < Math.min(i + samplesPerStep, samples.length); j++) {
      const value = Math.abs(samples[j] ?? 0);
      if (value > peak) peak = value;
    }
    out.push(peak);
  }
  return out;
}

/** Count the knocks: a rise past PULSE_ON after a dip below PULSE_OFF. */
function countPulses(levels: readonly number[]): number {
  let pulses = 0;
  let armed = true;
  for (const level of levels) {
    if (armed && level >= PULSE_ON) {
      pulses += 1;
      armed = false;
    } else if (!armed && level <= PULSE_OFF) {
      armed = true;
    }
  }
  return pulses;
}

/**
 * The preset the shape alone justifies.
 *
 * Nothing here reads a name or a category. A short tick is a selection
 * whatever it is called, and a long buzz is heavy.
 *
 * Two features decide it, and both were chosen because they vary across
 * the real set. Length runs from 70ms at the tenth percentile to 860ms at
 * the ninetieth. A sharp attack covers 43 percent of the set. A third
 * candidate, the mean level of the envelope, was measured and dropped: it
 * sits between 0.39 and 0.54 for eight sounds in ten, so it separates
 * almost nothing.
 *
 * The thresholds are the measured quartiles, not round numbers.
 */
function shapePreset(durationMs: number, sharp: boolean): HapticPreset {
  if (durationMs <= 60) return 'selection';
  if (durationMs <= 130) return sharp ? 'impactRigid' : 'impactLight';
  if (durationMs <= 500) return sharp ? 'impactMedium' : 'impactSoft';
  return 'impactHeavy';
}

/**
 * Turn a patch into a vibration.
 *
 * The render runs at the full rate. A cheaper rate was measured first and
 * rejected: at 16000 Hz a noise-heavy patch such as `lion-roar` drifted by
 * 0.5 of full scale, because noise aliases where a tone does not.
 */
export function toHaptic(patch: Patch, options: HapticOptions = {}): HapticPattern {
  const stepMs = Math.max(1, options.stepMs ?? HAPTIC_STEP_MS);
  const maxMs = Math.max(stepMs, options.maxMs ?? HAPTIC_MAX_MS);
  const floor = options.floor ?? HAPTIC_FLOOR;

  const samples = renderPatch(patch, RENDER_SAMPLE_RATE);
  const perStep = Math.max(1, Math.round((stepMs / 1000) * RENDER_SAMPLE_RATE));
  const raw = envelope(samples, perStep);

  const peak = Math.max(...raw, 0);
  // A silent patch has no vibration. Say so with an empty pattern rather
  // than divide by zero and return a wall of NaN.
  if (peak <= 0) {
    return { steps: [], durationMs: 0, preset: 'selection', pulses: 0, sharpness: 0 };
  }

  let levels = raw.map((value) => clamp01(value / peak));

  // Trim the silence at each end. A haptic that starts late feels late.
  let first = levels.findIndex((value) => value >= floor);
  if (first === -1) first = 0;
  let last = levels.length - 1;
  while (last > first && (levels[last] ?? 0) < floor) last -= 1;
  levels = levels.slice(first, last + 1);

  // Cut to length before the merge, so `maxMs` means what it says.
  const maxSteps = Math.max(1, Math.floor(maxMs / stepMs));
  if (levels.length > maxSteps) levels = levels.slice(0, maxSteps);

  const pulses = countPulses(levels);
  // Sharp means the envelope is at its peak inside the first 20ms.
  const sharp = levels.indexOf(Math.max(...levels)) <= 1;

  // Merge neighbours that feel the same. A motor cannot express a 2%
  // change, and a shorter array is cheaper to send across the bridge.
  const steps: HapticStep[] = [];
  for (const level of levels) {
    const previous = steps[steps.length - 1];
    if (previous && Math.abs(previous.intensity - level) <= MERGE_TOLERANCE) {
      previous.durationMs += stepMs;
      continue;
    }
    steps.push({ durationMs: stepMs, intensity: Math.round(level * 100) / 100 });
  }

  const durationMs = steps.reduce((total, step) => total + step.durationMs, 0);
  const descriptors = computeDescriptors(samples, RENDER_SAMPLE_RATE);

  return {
    steps,
    durationMs,
    pulses,
    preset: shapePreset(durationMs, sharp),
    sharpness: Math.round(clamp01(descriptors.brightnessHz / FULL_SHARPNESS_HZ) * 100) / 100,
  };
}

/**
 * Words that decide a notification preset.
 *
 * A phone's three notification haptics say success, warning and failure.
 * Audio cannot tell them apart: a two-knock success and a two-knock error
 * have the same envelope. The entry's own words can, so they decide, and
 * only here. `toHaptic` stays acoustic.
 */
const MEANING: { preset: HapticPreset; words: string[] }[] = [
  {
    preset: 'notificationError',
    words: ['error', 'fail', 'failed', 'failure', 'denied', 'reject', 'rejected', 'wrong', 'invalid', 'declined', 'crash', 'broken'],
  },
  {
    preset: 'notificationWarning',
    words: ['warning', 'warn', 'alert', 'caution', 'critical', 'danger', 'expire', 'expired'],
  },
  {
    preset: 'notificationSuccess',
    words: ['success', 'complete', 'completed', 'done', 'finish', 'finished', 'confirm', 'confirmed', 'approve', 'approved', 'unlock', 'unlocked', 'win', 'victory'],
  },
];

/** The rule words, stemmed once, so every lookup is a set hit. */
const MEANING_STEMS = MEANING.map((rule) => ({
  preset: rule.preset,
  stems: new Set(rule.words.flatMap((word) => terms(word))),
}));

/**
 * The vibration for a curated entry.
 *
 * Same as `toHaptic`, and then the entry's own words may raise the preset
 * to a notification. An entry may also carry `haptic` to say outright
 * which preset it wants, and that always wins.
 */
export function hapticFor(entry: SoundEntry, options: HapticOptions = {}): HapticPattern {
  const pattern = toHaptic(entry.patch, options);
  const override = entry.haptic;
  if (override) return { ...pattern, preset: override };

  // Stems, so "completed" and "finishing" reach the same rule as "complete".
  const words = new Set([...terms(entry.name.replace(/-/g, ' ')), ...terms(entry.phrase)]);
  for (const rule of MEANING_STEMS) {
    for (const stem of rule.stems) {
      if (words.has(stem)) return { ...pattern, preset: rule.preset };
    }
  }
  return pattern;
}

// ------------------------------------------------------------------ platforms

/**
 * Android `VibrationEffect.createWaveform(timings, amplitudes, -1)`.
 *
 * Amplitudes run 0 to 255, and 0 means off. Anything the pattern kept is
 * meant to be felt, so a non-zero intensity never rounds down to 0.
 * `hasAmplitudeControl()` must be true, or Android ignores the amplitudes
 * and buzzes at full strength for each timing.
 */
export function toAndroidWaveform(pattern: HapticPattern): { timings: number[]; amplitudes: number[] } {
  return {
    timings: pattern.steps.map((step) => step.durationMs),
    amplitudes: pattern.steps.map((step) => (step.intensity <= 0 ? 0 : Math.max(1, Math.round(step.intensity * 255)))),
  };
}

/**
 * `navigator.vibrate([on, off, on, off, ...])`.
 *
 * The web API has no amplitude at all, so the envelope collapses to on and
 * off at a threshold. The array must start with an on period, and a
 * pattern that begins below the threshold gets a 0 to keep the phase.
 *
 * iOS Safari does not support `navigator.vibrate`. Check for the function
 * before calling it; there is no polyfill for hardware that is not exposed.
 */
export function toWebVibrate(pattern: HapticPattern, threshold = 0.35): number[] {
  const out: number[] = [];
  let on = true;
  let run = 0;
  for (const step of pattern.steps) {
    const active = step.intensity >= threshold;
    if (active === on) {
      run += step.durationMs;
      continue;
    }
    out.push(run);
    on = active;
    run = step.durationMs;
  }
  if (run > 0) out.push(run);
  // Drop a trailing off period: it delays nothing and only wastes a slot.
  if (!on && out.length > 0) out.pop();
  return out;
}

/** One iOS Core Haptics event. Times and durations are in seconds. */
export type CoreHapticsEvent = {
  eventType: 'hapticContinuous';
  time: number;
  duration: number;
  intensity: number;
  sharpness: number;
};

/**
 * iOS Core Haptics, as a `CHHapticPattern` dictionary would hold it.
 *
 * Every step becomes one continuous event. Core Haptics also takes
 * parameter curves, which would be smoother, but a curve cannot be
 * expressed as plain data a bridge can carry without a custom decoder.
 */
export function toCoreHaptics(pattern: HapticPattern): CoreHapticsEvent[] {
  const events: CoreHapticsEvent[] = [];
  let time = 0;
  for (const step of pattern.steps) {
    events.push({
      eventType: 'hapticContinuous',
      time: Math.round(time) / 1000,
      duration: step.durationMs / 1000,
      intensity: step.intensity,
      sharpness: pattern.sharpness,
    });
    time += step.durationMs;
  }
  return events;
}
