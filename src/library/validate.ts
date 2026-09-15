import type { SoundEntry } from './types';
import { MAX_FREQ_HZ, MAX_LAYERS, MIN_FREQ_HZ, MIN_LAYERS, RENDER_SAMPLE_RATE } from './types';
import { renderPatch } from './render';
import { normalizePhrase } from './normalize-phrase';

export const MIN_DURATION_MS = 30;
export const MAX_DURATION_MS = 1500;
export const PEAK_CEILING = 0.891; // -1 dBFS
export const RMS_MIN_DB = -20;
export const RMS_MAX_DB = -14;
export const MAX_DC_OFFSET = 0.001;
export const MIN_KEYWORDS = 4;
export const MIN_CONCEPT_LENGTH = 20;
export const BRIGHTNESS_THRESHOLD_HZ = 1500;
export const DURATION_SHORT_MS = 200;
export const DURATION_LONG_MS = 800;

const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type PitchDirection = 'rising' | 'falling' | 'steady';
export type Attack = 'soft' | 'sharp';

export type Descriptors = {
  durationMs: number;
  peak: number;
  rmsDb: number;
  dcOffset: number;
  brightnessHz: number;
  pitchDirection: PitchDirection;
  attack: Attack;
};

function spectralCentroid(samples: Float32Array, sampleRate: number): number {
  const BIN_COUNT = 64;
  const maxFreq = sampleRate / 2;
  const stride = Math.max(1, Math.floor(samples.length / 4096));
  const magnitudes = new Float32Array(BIN_COUNT);

  for (let k = 0; k < BIN_COUNT; k++) {
    const freq = ((k + 1) / BIN_COUNT) * maxFreq;
    const omega = (2 * Math.PI * freq) / sampleRate;
    let real = 0;
    let imag = 0;
    let count = 0;
    for (let i = 0; i < samples.length; i += stride) {
      const sample = samples[i] ?? 0;
      real += sample * Math.cos(omega * i);
      imag -= sample * Math.sin(omega * i);
      count++;
    }
    magnitudes[k] = count > 0 ? Math.sqrt(real * real + imag * imag) / count : 0;
  }

  let weightedSum = 0;
  let totalMagnitude = 0;
  for (let k = 0; k < BIN_COUNT; k++) {
    const freq = ((k + 1) / BIN_COUNT) * maxFreq;
    weightedSum += freq * (magnitudes[k] ?? 0);
    totalMagnitude += magnitudes[k] ?? 0;
  }
  return totalMagnitude > 0 ? weightedSum / totalMagnitude : 0;
}

function zeroCrossingRate(samples: Float32Array, sampleRate: number, start: number, end: number): number {
  let crossings = 0;
  for (let i = start + 1; i < end; i++) {
    const prev = samples[i - 1] ?? 0;
    const current = samples[i] ?? 0;
    if ((prev < 0 && current >= 0) || (prev >= 0 && current < 0)) crossings++;
  }
  const durationSec = (end - start) / sampleRate;
  return durationSec > 0 ? crossings / 2 / durationSec : 0;
}

function estimatePitchDirection(samples: Float32Array, sampleRate: number): PitchDirection {
  const third = Math.floor(samples.length / 3);
  if (third < 4) return 'steady';
  const startFreq = zeroCrossingRate(samples, sampleRate, 0, third);
  const endFreq = zeroCrossingRate(samples, sampleRate, samples.length - third, samples.length);
  const ratio = endFreq / Math.max(startFreq, 1e-6);
  if (ratio > 1.15) return 'rising';
  if (ratio < 0.87) return 'falling';
  return 'steady';
}

function estimateAttack(samples: Float32Array): Attack {
  let peakIndex = 0;
  let peakValue = 0;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i] ?? 0);
    if (abs > peakValue) {
      peakValue = abs;
      peakIndex = i;
    }
  }
  const attackFraction = samples.length > 0 ? peakIndex / samples.length : 0;
  return attackFraction < 0.08 ? 'sharp' : 'soft';
}

export function computeDescriptors(samples: Float32Array, sampleRate: number): Descriptors {
  let peak = 0;
  let sumSquares = 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i] ?? 0;
    peak = Math.max(peak, Math.abs(sample));
    sumSquares += sample * sample;
    sum += sample;
  }
  const rms = Math.sqrt(sumSquares / Math.max(samples.length, 1));
  const rmsDb = 20 * Math.log10(Math.max(rms, 1e-9));
  const dcOffset = sum / Math.max(samples.length, 1);

  return {
    durationMs: (samples.length / sampleRate) * 1000,
    peak,
    rmsDb,
    dcOffset,
    brightnessHz: spectralCentroid(samples, sampleRate),
    pitchDirection: estimatePitchDirection(samples, sampleRate),
    attack: estimateAttack(samples),
  };
}

const CONCEPT_VOCABULARY: Array<{ words: string[]; check: (d: Descriptors) => boolean; label: string }> = [
  { words: ['rising', 'ascending'], check: (d) => d.pitchDirection === 'rising', label: 'a rising pitch' },
  { words: ['falling', 'descending'], check: (d) => d.pitchDirection === 'falling', label: 'a falling pitch' },
  { words: ['soft', 'gentle'], check: (d) => d.attack === 'soft', label: 'a soft attack' },
  { words: ['sharp', 'percussive'], check: (d) => d.attack === 'sharp', label: 'a sharp attack' },
  { words: ['bright'], check: (d) => d.brightnessHz >= BRIGHTNESS_THRESHOLD_HZ, label: 'a bright timbre' },
  { words: ['dark', 'warm'], check: (d) => d.brightnessHz < BRIGHTNESS_THRESHOLD_HZ, label: 'a dark timbre' },
  { words: ['short', 'quick'], check: (d) => d.durationMs <= DURATION_SHORT_MS, label: `a duration under ${DURATION_SHORT_MS}ms` },
  { words: ['long', 'sustained'], check: (d) => d.durationMs >= DURATION_LONG_MS, label: `a duration over ${DURATION_LONG_MS}ms` },
];

function checkConceptAgreement(concept: string, descriptors: Descriptors): string[] {
  const problems: string[] = [];
  const lowerConcept = concept.toLowerCase();
  for (const item of CONCEPT_VOCABULARY) {
    if (item.words.some((word) => lowerConcept.includes(word)) && !item.check(descriptors)) {
      problems.push(`concept mentions "${item.words[0]}" but the patch does not produce ${item.label}`);
    }
  }
  return problems;
}

export function checkEntry(entry: SoundEntry): string[] {
  const problems: string[] = [];

  if (!NAME_PATTERN.test(entry.name)) problems.push(`name "${entry.name}" must be kebab-case`);
  if (!NAME_PATTERN.test(entry.category)) problems.push(`category "${entry.category}" must be kebab-case`);
  if (entry.phrase.trim().length === 0) problems.push('phrase must not be empty');
  if (entry.concept.trim().length < MIN_CONCEPT_LENGTH) {
    problems.push(`concept must be at least ${MIN_CONCEPT_LENGTH} characters`);
  }
  if (entry.keywords.length < MIN_KEYWORDS) {
    problems.push(`needs at least ${MIN_KEYWORDS} keywords, has ${entry.keywords.length}`);
  }
  const seenKeywords = new Set<string>();
  for (const keyword of entry.keywords) {
    if (keyword !== keyword.trim().toLowerCase()) problems.push(`keyword "${keyword}" must be lowercase and trimmed`);
    if (seenKeywords.has(keyword)) problems.push(`duplicate keyword "${keyword}"`);
    seenKeywords.add(keyword);
  }
  if (entry.patch.layers.length < MIN_LAYERS || entry.patch.layers.length > MAX_LAYERS) {
    problems.push(`patch must have ${MIN_LAYERS}-${MAX_LAYERS} layers, has ${entry.patch.layers.length}`);
  }
  for (const layer of entry.patch.layers) {
    if (layer.source.type === 'oscillator') {
      if (layer.source.freqHz < MIN_FREQ_HZ || layer.source.freqHz > MAX_FREQ_HZ) {
        problems.push(`oscillator freqHz ${layer.source.freqHz} out of range ${MIN_FREQ_HZ}-${MAX_FREQ_HZ}`);
      }
    }
    if (layer.gain < 0 || layer.gain > 1) problems.push(`layer gain ${layer.gain} must be 0-1`);
  }

  let samples: Float32Array;
  try {
    samples = renderPatch(entry.patch);
  } catch (error) {
    problems.push(`patch failed to render: ${(error as Error).message}`);
    return problems;
  }

  const descriptors = computeDescriptors(samples, RENDER_SAMPLE_RATE);

  if (descriptors.durationMs < MIN_DURATION_MS || descriptors.durationMs > MAX_DURATION_MS) {
    problems.push(`duration ${descriptors.durationMs.toFixed(0)}ms out of range ${MIN_DURATION_MS}-${MAX_DURATION_MS}ms`);
  }
  if (descriptors.peak > PEAK_CEILING) {
    problems.push(`peak ${descriptors.peak.toFixed(3)} exceeds ceiling ${PEAK_CEILING}`);
  }
  if (descriptors.rmsDb < RMS_MIN_DB || descriptors.rmsDb > RMS_MAX_DB) {
    problems.push(`loudness ${descriptors.rmsDb.toFixed(1)}dB outside target window ${RMS_MIN_DB} to ${RMS_MAX_DB}dB`);
  }
  if (Math.abs(descriptors.dcOffset) > MAX_DC_OFFSET) {
    problems.push(`DC offset ${descriptors.dcOffset.toFixed(4)} exceeds ${MAX_DC_OFFSET}`);
  }
  if (Math.abs(samples[0] ?? 0) > 0.01 || Math.abs(samples[samples.length - 1] ?? 0) > 0.01) {
    problems.push('start or end sample is not faded to near zero');
  }

  problems.push(...checkConceptAgreement(entry.concept, descriptors));

  return problems;
}

export function checkLibrary(entries: SoundEntry[]): Map<string, string[]> {
  const results = new Map<string, string[]>();
  const seenNames = new Set<string>();
  const seenPhrases = new Set<string>();

  entries.forEach((entry, index) => {
    const key = `${index}: ${entry.name}`;
    const problems = checkEntry(entry);

    if (seenNames.has(entry.name)) problems.push(`duplicate name "${entry.name}"`);
    seenNames.add(entry.name);

    const phraseKey = normalizePhrase(entry.phrase);
    if (seenPhrases.has(phraseKey)) problems.push(`duplicate phrase "${entry.phrase}"`);
    seenPhrases.add(phraseKey);

    if (problems.length > 0) results.set(key, problems);
  });

  return results;
}
