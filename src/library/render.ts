import type { Envelope, Filter, Layer, Patch, Wave } from './types';
import { RENDER_SAMPLE_RATE } from './types';

const SINE_TABLE_SIZE = 2048;
const sineTable = new Float32Array(SINE_TABLE_SIZE);
for (let i = 0; i < SINE_TABLE_SIZE; i++) {
  sineTable[i] = Math.sin((2 * Math.PI * i) / SINE_TABLE_SIZE);
}

function tableSine(phase01: number): number {
  const pos = phase01 * SINE_TABLE_SIZE;
  const i0 = pos | 0;
  const frac = pos - i0;
  const i1 = (i0 + 1) & (SINE_TABLE_SIZE - 1);
  const v0 = sineTable[i0] ?? 0;
  const v1 = sineTable[i1] ?? 0;
  return v0 + (v1 - v0) * frac;
}

function waveAt(wave: Wave, phase01: number): number {
  switch (wave) {
    case 'sine':
      return tableSine(phase01);
    case 'triangle':
      return 4 * Math.abs(phase01 - 0.5) - 1;
    case 'square':
      return phase01 < 0.5 ? 1 : -1;
    case 'saw':
      return 2 * phase01 - 1;
    default:
      return tableSine(phase01);
  }
}

function createRng(seed: number) {
  let state = seed || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state |= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state |= 0;
    return (state >>> 0) / 0xffffffff;
  };
}

function envelopeDurationMs(env: Envelope): number {
  return env.attackMs + env.decayMs + env.sustainMs + env.releaseMs;
}

// Precomputed sample-index breakpoints for one envelope, so the per-sample
// hot loop (envelopeAt) does no division setup work, only a few branches
// and one division whose denominator is already known.
type EnvelopeBreakpoints = {
  attackSamples: number;
  decayStart: number;
  sustainStart: number;
  releaseStart: number;
  releaseSamples: number;
  sustainLevel: number;
};

function computeBreakpoints(env: Envelope, sampleRate: number): EnvelopeBreakpoints {
  const attackSamples = Math.max(1, Math.round((env.attackMs / 1000) * sampleRate));
  const decaySamples = Math.max(1, Math.round((env.decayMs / 1000) * sampleRate));
  const sustainSamples = Math.max(0, Math.round((env.sustainMs / 1000) * sampleRate));
  const releaseSamples = Math.max(1, Math.round((env.releaseMs / 1000) * sampleRate));
  const decayStart = attackSamples;
  const sustainStart = decayStart + decaySamples;
  const releaseStart = sustainStart + sustainSamples;
  return { attackSamples, decayStart, sustainStart, releaseStart, releaseSamples, sustainLevel: env.sustainLevel };
}

function envelopeAt(i: number, bp: EnvelopeBreakpoints): number {
  if (i < bp.attackSamples) return i / bp.attackSamples;
  if (i < bp.sustainStart) {
    const t = (i - bp.decayStart) / (bp.sustainStart - bp.decayStart);
    return 1 - t * (1 - bp.sustainLevel);
  }
  if (i < bp.releaseStart) return bp.sustainLevel;
  const t = (i - bp.releaseStart) / bp.releaseSamples;
  return t < 1 ? bp.sustainLevel * (1 - t) : 0;
}

function onePoleLowpassInPlace(data: Float32Array, cutoffHz: number, sampleRate: number): void {
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const dt = 1 / sampleRate;
  const alpha = dt / (rc + dt);
  let prev = 0;
  for (let i = 0; i < data.length; i++) {
    prev += alpha * ((data[i] ?? 0) - prev);
    data[i] = prev;
  }
}

function onePoleHighpassInPlace(data: Float32Array, cutoffHz: number, sampleRate: number): void {
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const dt = 1 / sampleRate;
  const beta = rc / (rc + dt);
  let prevIn = 0;
  let prevOut = 0;
  for (let i = 0; i < data.length; i++) {
    const current = data[i] ?? 0;
    const value = beta * (prevOut + current - prevIn);
    prevOut = value;
    prevIn = current;
    data[i] = value;
  }
}

function applyFilterInPlace(data: Float32Array, filter: Filter, sampleRate: number): void {
  if (filter.type === 'lowpass') {
    onePoleLowpassInPlace(data, filter.cutoffHz, sampleRate);
    return;
  }
  if (filter.type === 'highpass') {
    onePoleHighpassInPlace(data, filter.cutoffHz, sampleRate);
    return;
  }
  onePoleLowpassInPlace(data, filter.cutoffHz, sampleRate);
  onePoleHighpassInPlace(data, filter.cutoffHz / 4, sampleRate);
}

function renderLayer(layer: Layer, sampleCount: number, sampleRate: number, seed: number): Float32Array {
  const out = new Float32Array(sampleCount);
  const bp = computeBreakpoints(layer.envelope, sampleRate);

  if (layer.source.type === 'oscillator') {
    const { wave, freqHz, pitchEnvelope } = layer.source;
    let phase = 0;
    const sweepSamples = pitchEnvelope
      ? Math.max(1, Math.round((pitchEnvelope.timeMs / 1000) * sampleRate))
      : 0;
    for (let i = 0; i < sampleCount; i++) {
      let freq = freqHz;
      if (pitchEnvelope) {
        const t = i < sweepSamples ? i / sweepSamples : 1;
        freq = freqHz + (pitchEnvelope.toHz - freqHz) * t;
      }
      out[i] = waveAt(wave, phase) * envelopeAt(i, bp);
      phase += freq / sampleRate;
      if (phase >= 1) phase -= Math.floor(phase);
    }
  } else if (layer.source.color === 'white') {
    const rng = createRng(seed);
    for (let i = 0; i < sampleCount; i++) {
      out[i] = (rng() * 2 - 1) * envelopeAt(i, bp);
    }
  } else {
    // Pink-ish noise via a one-pole lowpass over white noise.
    const rng = createRng(seed);
    let prev = 0;
    for (let i = 0; i < sampleCount; i++) {
      const white = rng() * 2 - 1;
      prev += 0.1 * (white - prev);
      out[i] = prev * 3 * envelopeAt(i, bp);
    }
  }

  if (layer.filter) applyFilterInPlace(out, layer.filter, sampleRate);
  for (let i = 0; i < sampleCount; i++) out[i] = (out[i] ?? 0) * layer.gain;
  return out;
}

const FADE_MS = 3;
const PEAK_CEILING = 0.891; // -1 dBFS

export function renderPatch(patch: Patch, sampleRate: number = RENDER_SAMPLE_RATE): Float32Array {
  const durationMs = Math.max(...patch.layers.map((layer) => envelopeDurationMs(layer.envelope)));
  const sampleCount = Math.max(1, Math.round((durationMs / 1000) * sampleRate));
  const mix = new Float32Array(sampleCount);

  patch.layers.forEach((layer, layerIndex) => {
    const layerOut = renderLayer(layer, sampleCount, sampleRate, 0x9e3779b9 + layerIndex * 0x1000193);
    for (let i = 0; i < sampleCount; i++) mix[i] += layerOut[i] ?? 0;
  });

  // Remove any residual DC bias before fading/limiting. Multiplying a
  // zero-mean signal (an oscillator cycle, generated noise) by a
  // time-varying envelope does not generally preserve zero-mean -- a
  // partial cycle caught by a fast attack, or a noise layer's specific
  // realization, can leave a small but real offset. Two independent batch
  // agents hit this on unrelated patches (a plain low sine, and a filtered
  // pink noise layer) and worked around it by hand-tuning frequency/attack
  // or swapping filter types; removing it here means no patch has to.
  let dcSum = 0;
  for (let i = 0; i < sampleCount; i++) dcSum += mix[i] ?? 0;
  const dcOffset = dcSum / sampleCount;
  if (dcOffset !== 0) {
    for (let i = 0; i < sampleCount; i++) mix[i] = (mix[i] ?? 0) - dcOffset;
  }

  const fadeSamples = Math.max(1, Math.round((FADE_MS / 1000) * sampleRate));
  const fadeCount = Math.min(fadeSamples, sampleCount);
  for (let i = 0; i < fadeCount; i++) {
    const rampGain = i / fadeSamples;
    mix[i] = (mix[i] ?? 0) * rampGain;
    const endIndex = sampleCount - 1 - i;
    mix[endIndex] = (mix[endIndex] ?? 0) * rampGain;
  }

  let peak = 0;
  for (let i = 0; i < sampleCount; i++) peak = Math.max(peak, Math.abs(mix[i] ?? 0));
  if (peak > PEAK_CEILING) {
    const scale = PEAK_CEILING / peak;
    for (let i = 0; i < sampleCount; i++) mix[i] = (mix[i] ?? 0) * scale;
  }

  return mix;
}
