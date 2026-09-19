import { describe, it, expect } from 'vitest';
import {
  toHaptic,
  hapticFor,
  toAndroidWaveform,
  toWebVibrate,
  toCoreHaptics,
  HAPTIC_STEP_MS,
} from './haptic';
import { sounds } from './index';
import type { Patch, SoundEntry } from './types';

const entry = (name: string): SoundEntry => {
  const found = sounds.find((s) => s.name === name);
  if (!found) throw new Error(`the set has no "${name}"`);
  return found;
};

const SILENT: Patch = {
  layers: [
    {
      source: { type: 'oscillator', wave: 'sine', freqHz: 440 },
      envelope: { attackMs: 10, decayMs: 10, sustainLevel: 0, sustainMs: 10, releaseMs: 10 },
      gain: 0,
    },
  ],
};

describe('toHaptic', () => {
  it('gives a real envelope, not a flat line', () => {
    const pattern = toHaptic(entry('coin-pickup').patch);
    expect(pattern.steps.length).toBeGreaterThan(2);
    expect(new Set(pattern.steps.map((s) => s.intensity)).size).toBeGreaterThan(2);
  });

  it('holds every intensity inside 0 and 1, and reaches 1', () => {
    for (const name of ['tap', 'error-buzz', 'drone-low', 'heartbeat']) {
      const pattern = toHaptic(entry(name).patch);
      for (const step of pattern.steps) {
        expect(step.intensity).toBeGreaterThanOrEqual(0);
        expect(step.intensity).toBeLessThanOrEqual(1);
      }
      // The envelope is normalised, so the loudest moment is full strength.
      expect(Math.max(...pattern.steps.map((s) => s.intensity))).toBe(1);
    }
  });

  it('reports a duration that equals the steps it holds', () => {
    const pattern = toHaptic(entry('doorbell').patch);
    expect(pattern.steps.reduce((t, s) => t + s.durationMs, 0)).toBe(pattern.durationMs);
  });

  it('never runs past maxMs', () => {
    const pattern = toHaptic(entry('drone-low').patch, { maxMs: 200 });
    expect(pattern.durationMs).toBeLessThanOrEqual(200);
  });

  it('starts at once, with no leading silence', () => {
    // A haptic that begins with an empty step feels late.
    const pattern = toHaptic(entry('upload-complete').patch);
    expect(pattern.steps[0]!.intensity).toBeGreaterThanOrEqual(0.08);
  });

  it('ends on something you can feel', () => {
    const pattern = toHaptic(entry('upload-complete').patch);
    expect(pattern.steps[pattern.steps.length - 1]!.intensity).toBeGreaterThanOrEqual(0.08);
  });

  it('merges neighbours instead of sending one step every 10ms', () => {
    const pattern = toHaptic(entry('drone-low').patch);
    const unmerged = Math.round(pattern.durationMs / HAPTIC_STEP_MS);
    expect(pattern.steps.length).toBeLessThan(unmerged);
  });

  it('gives a silent patch an empty pattern, not a wall of NaN', () => {
    const pattern = toHaptic(SILENT);
    expect(pattern.steps).toEqual([]);
    expect(pattern.durationMs).toBe(0);
    expect(Number.isNaN(pattern.sharpness)).toBe(false);
  });

  it('reads sharpness from brightness, so a bright sound feels crisp', () => {
    const bright = toHaptic(entry('key-press').patch).sharpness;
    const dark = toHaptic(entry('drone-low').patch).sharpness;
    expect(bright).toBeGreaterThan(dark);
    expect(dark).toBeGreaterThanOrEqual(0);
    expect(bright).toBeLessThanOrEqual(1);
  });

  it('is deterministic', () => {
    expect(toHaptic(entry('tap').patch)).toEqual(toHaptic(entry('tap').patch));
  });

  it('picks a short preset for a short sound and a long one for a long sound', () => {
    expect(toHaptic(entry('tap').patch).preset).toBe('selection');
    expect(toHaptic(entry('drone-low').patch).preset).toBe('impactHeavy');
  });

  // One pass over all 1090 sounds, and only one. Rendering the set costs
  // about six seconds, and `hapticFor` renders again, so calling both here
  // doubled the time for nothing: the preset rules have their own tests.
  it('gives every sound a usable pattern, and never a notification preset', () => {
    for (const sound of sounds) {
      const pattern = toHaptic(sound.patch);
      expect(pattern.steps.length, sound.name).toBeGreaterThan(0);
      expect(pattern.durationMs, sound.name).toBeGreaterThan(0);
      expect(Number.isFinite(pattern.sharpness), sound.name).toBe(true);
      // Meaning is not in the audio. Only hapticFor may reach for these.
      expect(pattern.preset.startsWith('notification'), sound.name).toBe(false);
    }
  });
});

describe('hapticFor', () => {
  it('raises a failure to the error preset', () => {
    expect(hapticFor(entry('payment-declined')).preset).toBe('notificationError');
    expect(hapticFor(entry('upload-failed')).preset).toBe('notificationError');
  });

  it('raises a finish to the success preset', () => {
    expect(hapticFor(entry('upload-complete')).preset).toBe('notificationSuccess');
    expect(hapticFor(entry('workout-done')).preset).toBe('notificationSuccess');
  });

  it('raises an alert to the warning preset', () => {
    expect(hapticFor(entry('battery-critical')).preset).toBe('notificationWarning');
  });

  it('leaves a sound with no such meaning on its shape preset', () => {
    const plain = entry('dog-bark');
    expect(hapticFor(plain).preset).toBe(toHaptic(plain.patch).preset);
  });

  it('changes nothing but the preset', () => {
    const plain = entry('upload-complete');
    const { preset: _a, ...restShape } = toHaptic(plain.patch);
    const { preset: _b, ...restMeaning } = hapticFor(plain);
    expect(restMeaning).toEqual(restShape);
  });

  it('lets an entry override the guess', () => {
    const forced: SoundEntry = { ...entry('dog-bark'), haptic: 'notificationWarning' };
    expect(hapticFor(forced).preset).toBe('notificationWarning');
  });

  it('matches an inflected word through the stemmer', () => {
    const made: SoundEntry = { ...entry('dog-bark'), name: 'thing-completed', phrase: 'thing completed' };
    expect(hapticFor(made).preset).toBe('notificationSuccess');
  });
});

describe('toAndroidWaveform', () => {
  it('pairs one timing with one amplitude', () => {
    const { timings, amplitudes } = toAndroidWaveform(toHaptic(entry('coin-pickup').patch));
    expect(timings.length).toBe(amplitudes.length);
    expect(timings.length).toBeGreaterThan(0);
  });

  it('keeps every amplitude inside the 0 to 255 range Android takes', () => {
    for (const name of ['tap', 'drone-low', 'error-buzz']) {
      for (const value of toAndroidWaveform(toHaptic(entry(name).patch)).amplitudes) {
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(255);
      }
    }
  });

  it('never rounds a felt step down to silence', () => {
    // 0 means off on Android. A step the pattern kept must be felt.
    const pattern = toHaptic(entry('drone-low').patch);
    const { amplitudes } = toAndroidWaveform(pattern);
    pattern.steps.forEach((step, i) => {
      if (step.intensity > 0) expect(amplitudes[i]).toBeGreaterThanOrEqual(1);
    });
  });

  it('keeps the total length', () => {
    const pattern = toHaptic(entry('doorbell').patch);
    expect(toAndroidWaveform(pattern).timings.reduce((a, b) => a + b, 0)).toBe(pattern.durationMs);
  });
});

describe('toWebVibrate', () => {
  it('gives a plain list of numbers', () => {
    const out = toWebVibrate(toHaptic(entry('coin-pickup').patch));
    expect(out.length).toBeGreaterThan(0);
    for (const value of out) expect(Number.isFinite(value)).toBe(true);
  });

  it('never ends on an off period, which would delay nothing', () => {
    for (const name of ['tap', 'coin-pickup', 'doorbell', 'drone-low']) {
      const out = toWebVibrate(toHaptic(entry(name).patch));
      // Odd indexes are off periods, so a valid list has odd length.
      expect(out.length % 2, name).toBe(1);
    }
  });

  it('never runs longer than the pattern it came from', () => {
    const pattern = toHaptic(entry('doorbell').patch);
    const total = toWebVibrate(pattern).reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(pattern.durationMs);
  });

  it('gives more on-time at a lower threshold', () => {
    const pattern = toHaptic(entry('doorbell').patch);
    const on = (t: number): number => toWebVibrate(pattern, t).filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0);
    expect(on(0.1)).toBeGreaterThanOrEqual(on(0.8));
  });
});

describe('toCoreHaptics', () => {
  it('lays the events end to end, in seconds', () => {
    const pattern = toHaptic(entry('doorbell').patch);
    const events = toCoreHaptics(pattern);
    expect(events.length).toBe(pattern.steps.length);
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.time).toBeGreaterThan(events[i - 1]!.time);
    }
    const last = events[events.length - 1]!;
    expect((last.time + last.duration) * 1000).toBeCloseTo(pattern.durationMs, 0);
  });

  it('carries the pattern sharpness on every event', () => {
    const pattern = toHaptic(entry('key-press').patch);
    for (const event of toCoreHaptics(pattern)) {
      expect(event.sharpness).toBe(pattern.sharpness);
      expect(event.eventType).toBe('hapticContinuous');
    }
  });
});
