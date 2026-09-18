import { describe, it, expect } from 'vitest';
import { renderPatch } from './render';
import type { Patch } from './types';
import { RENDER_SAMPLE_RATE } from './types';

function simplePatch(overrides: Partial<Patch['layers'][0]> = {}): Patch {
  return {
    layers: [
      {
        source: { type: 'oscillator', wave: 'sine', freqHz: 440 },
        envelope: { attackMs: 5, decayMs: 20, sustainLevel: 0.3, sustainMs: 20, releaseMs: 30 },
        gain: 0.8,
        ...overrides,
      },
    ],
  };
}

describe('renderPatch', () => {
  it('is deterministic for the same patch', () => {
    const patch = simplePatch();
    const a = renderPatch(patch);
    const b = renderPatch(patch);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toBe(b[i]);
    }
  });

  it('derives duration from the longest layer envelope', () => {
    const patch = simplePatch(); // 5+20+20+30 = 75ms
    const samples = renderPatch(patch);
    const expectedSamples = Math.round((75 / 1000) * RENDER_SAMPLE_RATE);
    expect(samples.length).toBe(expectedSamples);
  });

  it('fades in and out so start and end are near zero', () => {
    const samples = renderPatch(simplePatch());
    expect(Math.abs(samples[0] ?? 0)).toBeLessThan(0.01);
    expect(Math.abs(samples[samples.length - 1] ?? 0)).toBeLessThan(0.01);
  });

  it('never exceeds the peak ceiling even with 4 loud layers', () => {
    const patch: Patch = {
      layers: Array.from({ length: 4 }, (_, i) => ({
        source: { type: 'oscillator' as const, wave: 'sine' as const, freqHz: 300 + i * 50 },
        envelope: { attackMs: 2, decayMs: 10, sustainLevel: 1, sustainMs: 50, releaseMs: 10 },
        gain: 1,
      })),
    };
    const samples = renderPatch(patch);
    let peak = 0;
    for (const s of samples) peak = Math.max(peak, Math.abs(s));
    expect(peak).toBeLessThanOrEqual(0.891 + 1e-6);
  });

  it('renders noise layers without throwing', () => {
    const patch: Patch = {
      layers: [
        {
          source: { type: 'noise', color: 'white' },
          envelope: { attackMs: 1, decayMs: 10, sustainLevel: 0, sustainMs: 0, releaseMs: 20 },
          gain: 0.5,
        },
      ],
    };
    expect(() => renderPatch(patch)).not.toThrow();
  });

  it('never leaves a DC bias on a filtered pink noise layer', () => {
    // Regression test: the leaky-integrator pink noise approximation isn't
    // exactly zero-mean over a finite window by chance, and a lowpass
    // filter passes that bias through unchanged. A batch agent hit this as
    // a contract-failing DC offset on an otherwise valid patch.
    const patch: Patch = {
      layers: [
        {
          source: { type: 'noise', color: 'pink' },
          envelope: { attackMs: 5, decayMs: 20, sustainLevel: 0.6, sustainMs: 80, releaseMs: 30 },
          filter: { type: 'lowpass', cutoffHz: 900 },
          gain: 0.6,
        },
      ],
    };
    const samples = renderPatch(patch);
    let sum = 0;
    for (const s of samples) sum += s;
    const dcOffset = sum / samples.length;
    expect(Math.abs(dcOffset)).toBeLessThan(0.001);
  });

  it('stays far faster than a naive per-sample implementation', () => {
    // This test guards one thing: that the renderer still uses a wavetable
    // oscillator, a recurrence envelope and a fast PRNG, rather than calling
    // Math.sin/Math.exp/Math.random for every sample.
    //
    // It measures a ratio, not a wall-clock budget. An absolute threshold
    // cannot do this job: on a loaded shared machine the real renderer's
    // median ranges from about 5ms to 12ms for this patch, which overlaps
    // what the naive version measures on an idle one. Timing both
    // implementations back to back cancels the machine out, because load
    // scales them together.
    const patch: Patch = {
      layers: Array.from({ length: 4 }, (_, i) => ({
        source: { type: 'oscillator' as const, wave: 'sine' as const, freqHz: 220 + i * 110 },
        envelope: { attackMs: 5, decayMs: 100, sustainLevel: 0.4, sustainMs: 700, releaseMs: 195 },
        filter: { type: 'lowpass' as const, cutoffHz: 4000 },
        gain: 0.5,
      })),
    };

    // The implementation this renderer deliberately moved away from.
    const naive = (): Float32Array => {
      const sampleCount = Math.round((1.0 * RENDER_SAMPLE_RATE * 1000) / 1000);
      const out = new Float32Array(sampleCount);
      for (let layer = 0; layer < 4; layer++) {
        const freq = 220 + layer * 110;
        let phase = 0;
        let filterState = 0;
        for (let i = 0; i < sampleCount; i++) {
          const env = Math.exp((-i / RENDER_SAMPLE_RATE) * 6);
          const noise = Math.random() * 2 - 1;
          const raw = Math.sin(phase) * 0.5 + noise * 0.1;
          phase += (2 * Math.PI * freq) / RENDER_SAMPLE_RATE;
          filterState += 0.2 * (raw - filterState);
          out[i] = (out[i] ?? 0) + filterState * env * 0.25;
        }
      }
      return out;
    };

    const medianOf = (run: () => unknown): number => {
      for (let i = 0; i < 5; i++) run();
      const times: number[] = [];
      for (let i = 0; i < 21; i++) {
        const start = performance.now();
        run();
        times.push(performance.now() - start);
      }
      times.sort((a, b) => a - b);
      return times[Math.floor(times.length / 2)]!;
    };

    // Interleave the two measurements, so a load spike during the run hits
    // both rather than only the one measured second.
    const realFirst = medianOf(() => renderPatch(patch));
    const naiveMedian = medianOf(naive);
    const realSecond = medianOf(() => renderPatch(patch));
    const real = Math.min(realFirst, realSecond);

    expect(naiveMedian / real).toBeGreaterThan(2);
  });
});
