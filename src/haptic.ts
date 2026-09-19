// Vibration, on its own.
//
//   import { toHaptic, toAndroidWaveform } from 'semantic-sounds/haptic';
//
// This entry point holds the derivation and the three platform encoders
// and nothing else. It does not import the 1090-sound set, so a caller who
// only wants to turn their own patch into a vibration pays for the
// renderer and no more.
export * from './library/haptic';
export type { Patch, SoundEntry, HapticPreset } from './library/types';
