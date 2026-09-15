export const RENDER_SAMPLE_RATE = 48000;
export const MIN_LAYERS = 1;
export const MAX_LAYERS = 4;
export const MIN_FREQ_HZ = 40;
export const MAX_FREQ_HZ = 8000;

export type Wave = 'sine' | 'triangle' | 'square' | 'saw';
export type NoiseColor = 'white' | 'pink';
export type FilterType = 'lowpass' | 'highpass' | 'bandpass';

export type OscillatorSource = {
  type: 'oscillator';
  wave: Wave;
  freqHz: number;
  pitchEnvelope?: { toHz: number; timeMs: number };
};

export type NoiseSource = {
  type: 'noise';
  color: NoiseColor;
};

export type Envelope = {
  attackMs: number;
  decayMs: number;
  sustainLevel: number;
  sustainMs: number;
  releaseMs: number;
};

export type Filter = {
  type: FilterType;
  cutoffHz: number;
  q?: number;
};

export type Layer = {
  source: OscillatorSource | NoiseSource;
  envelope: Envelope;
  filter?: Filter;
  gain: number;
};

export type Patch = {
  layers: Layer[];
};

export type SoundEntry = {
  name: string;
  phrase: string;
  category: string;
  concept: string;
  keywords: string[];
  patch: Patch;
};

export type SoundMatch = {
  sound: SoundEntry;
  score: number;
  matched: string[];
};
