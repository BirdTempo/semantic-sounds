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

/**
 * The nine standard vibration presets, named as `expo-haptics` names them.
 * Declared here so an entry can name one without a cycle through haptic.ts.
 */
export type HapticPreset =
  | 'selection'
  | 'impactSoft'
  | 'impactLight'
  | 'impactRigid'
  | 'impactMedium'
  | 'impactHeavy'
  | 'notificationSuccess'
  | 'notificationWarning'
  | 'notificationError';

export type SoundEntry = {
  name: string;
  phrase: string;
  category: string;
  concept: string;
  keywords: string[];
  patch: Patch;
  /**
   * Force the vibration preset, when the derived one is wrong.
   *
   * `hapticFor` guesses from the entry's words, and a guess can miss:
   * "critical hit" is a strong blow in a game, not a warning. Set this to
   * settle it. Optional, and rare by design.
   */
  haptic?: HapticPreset;
};

export type SoundMatch = {
  sound: SoundEntry;
  score: number;
  matched: string[];
};
