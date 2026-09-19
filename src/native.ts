// Semantic Sounds on React Native.
//
//   import { createNativeSounds } from 'semantic-sounds/native';
//
// React Native has no Web Audio API, so a patch cannot go straight to the
// speaker the way it does in a page. The path here is:
//
//   patch -> renderPatch -> encodeWav -> base64 -> a file -> a native player
//
// Everything left of the file is this library, and works on Hermes with no
// platform API at all. Everything right of it is the app's own choice of
// audio library, so this module asks for four small functions rather than
// depend on one.
//
// A rendered sound is written once and kept. The second play of the same
// sound reads the file that is already there.
import {
  createSemanticSounds,
  type SemanticSounds,
  type SearchOptions,
  type SoundEntry,
  type SoundMatch,
  type Patch,
  type Tweak,
  type HapticPattern,
} from './sdk';
import type { HapticPreset } from './library/index';

export type { SoundEntry, SoundMatch, SearchOptions, Patch, Tweak, HapticPattern, HapticPreset };

/**
 * The four things this module cannot do by itself.
 *
 * With `expo-file-system` and `expo-audio`:
 *
 *   import * as FileSystem from 'expo-file-system';
 *   import { createAudioPlayer } from 'expo-audio';
 *
 *   const sounds = createNativeSounds({
 *     cacheDir: FileSystem.cacheDirectory + 'semantic-sounds/',
 *     writeFile: (uri, base64) =>
 *       FileSystem.writeAsStringAsync(uri, base64, { encoding: 'base64' }),
 *     fileExists: async (uri) => (await FileSystem.getInfoAsync(uri)).exists,
 *     playFile: async (uri) => { createAudioPlayer({ uri }).play(); },
 *   });
 *
 * `react-native-fs` and `react-native-sound` fit the same four slots.
 */
export type NativeOptions = {
  /**
   * A directory for the rendered files. It must end with a separator, and
   * it must already exist, or `writeFile` must create it.
   */
  cacheDir: string;
  /** Write a base64 payload to a file. */
  writeFile(uri: string, base64: string): Promise<void>;
  /** True when that file is on disk already. */
  fileExists(uri: string): Promise<boolean>;
  /** Play the file. */
  playFile(uri: string): Promise<void>;
  /**
   * Vibrate. Optional: leave it out and the module plays sound only.
   *
   * A phone on silent still buzzes, so for many people the vibration *is*
   * the notification. It gets both levels, and the adapter uses whichever
   * its platform supports:
   *
   *   vibrate: async ({ preset }) => Haptics.impactAsync(map[preset]),
   *
   * `expo-haptics` takes presets and nothing else, so `preset` is the
   * portable path. `steps` is there for a native module that can play a
   * real envelope, through `toAndroidWaveform` or `toCoreHaptics`.
   */
  vibrate?(pattern: HapticPattern): Promise<void> | void;
  /**
   * The set to use. Defaults to all 1090 curated sounds.
   *
   * An app that needs twenty sounds should ship twenty patches. Write the
   * subset with `npx semantic-sounds-pick`, and pass it here.
   */
  sounds?: readonly SoundEntry[];
};

export type NativeSounds = {
  /** Every sound in use. */
  readonly sounds: readonly SoundEntry[];
  /** Rank the set against plain prose. */
  search(query: string, options?: SearchOptions): SoundMatch[];
  /** The best sound for the prose, or null. */
  find(query: string, options?: SearchOptions): SoundEntry | null;
  /** One sound by its stable name, or null. */
  get(name: string): SoundEntry | null;
  /** Every category name, sorted. */
  categories(): string[];
  /**
   * Render and cache a sound without playing it.
   *
   * Call it when a screen opens, so the first play has no wait. Returns
   * the file uri.
   */
  prepare(source: Source, options?: Tweak): Promise<string>;
  /** Prepare several at once. */
  prepareAll(sources: Source[], options?: Tweak): Promise<string[]>;
  /**
   * Render if needed, then play. Returns the file uri.
   *
   * Pass `haptic: true` to vibrate at the same moment. The vibration is
   * not awaited before the sound starts: a haptic that lags its sound by
   * even a little reads as two events instead of one.
   */
  play(source: Source, options?: PlayOptions): Promise<string>;
  /** The vibration for a sound, without playing anything. */
  haptic(source: Source): HapticPattern;
  /** Where a sound's file goes. The same input always gives the same uri. */
  uriFor(source: Source, options?: Tweak): string;
  /** Forget what is cached in memory. The files stay on disk. */
  clearMemo(): void;
};

/** A sound entry, its stable name, or a bare patch. */
export type Source = SoundEntry | string | Patch;

export type PlayOptions = Tweak & {
  /** Also vibrate. Needs a `vibrate` adapter; without one it does nothing. */
  haptic?: boolean;
  /** Vibrate and play no sound. Useful on a phone set to silent. */
  hapticOnly?: boolean;
};

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Bytes to base64, without `Buffer` or `btoa`.
 *
 * React Native has neither in every runtime, and the ones that add `btoa`
 * take a string, so a byte above 127 has to be smuggled through a
 * character code first. This is shorter than that dance and has no
 * platform requirement at all.
 */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += BASE64[(n >> 18) & 63]! + BASE64[(n >> 12) & 63]! + BASE64[(n >> 6) & 63]! + BASE64[n & 63]!;
  }
  // The tail: one or two bytes left over, padded with "=" to a multiple
  // of four. Dropping the padding makes a file some decoders refuse.
  const left = bytes.length - i;
  if (left === 1) {
    const n = (bytes[i] ?? 0) << 16;
    out += BASE64[(n >> 18) & 63]! + BASE64[(n >> 12) & 63]! + '==';
  } else if (left === 2) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8);
    out += BASE64[(n >> 18) & 63]! + BASE64[(n >> 12) & 63]! + BASE64[(n >> 6) & 63]! + '=';
  }
  return out;
}

/** A short, stable, file-safe id for a patch that has no name. */
function fingerprint(patch: Patch): string {
  const text = JSON.stringify(patch);
  // FNV-1a. It only has to separate the patches one app uses, and a
  // cryptographic hash would be a dependency for no gain.
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `patch-${hash.toString(36)}`;
}

/**
 * The file name, including the tweak.
 *
 * The tweak has to be in the name. Without it, a sound played five
 * semitones down would find the plain file already on disk and play that
 * instead, and nothing would say why.
 */
function fileName(name: string, options: Tweak): string {
  const steps = options.semitones ?? 0;
  const scale = options.stretch ?? 1;
  const parts = [name];
  if (steps !== 0) parts.push(`${steps > 0 ? 'up' : 'down'}${Math.abs(steps)}`);
  if (scale !== 1) parts.push(`x${String(scale).replace('.', 'p')}`);
  return `${parts.join('-')}.wav`;
}

export function createNativeSounds(options: NativeOptions): NativeSounds {
  const { cacheDir, writeFile, fileExists, playFile, vibrate } = options;
  const api: SemanticSounds = createSemanticSounds(
    options.sounds === undefined ? {} : { sounds: options.sounds }
  );

  // One promise per uri. Two plays of the same sound in the same frame
  // must not both render it and both write the file.
  const inFlight = new Map<string, Promise<string>>();

  /** An entry, a name, or a bare patch, resolved to a patch and a name. */
  function resolve(source: Source): { patch: Patch; name: string } {
    if (typeof source === 'string') {
      const entry = api.get(source);
      if (entry === null) {
        throw new Error(`no sound is named "${source}". Use find() to search by prose, or check the subset you shipped.`);
      }
      return { patch: entry.patch, name: entry.name };
    }
    if ('patch' in source) return { patch: source.patch, name: source.name };
    return { patch: source, name: fingerprint(source) };
  }

  /**
   * The vibration for a source.
   *
   * A standalone function, not a method on the returned object. `play`
   * needs it, and reaching for it through `this` would break the moment a
   * caller wrote `const { play } = sounds`.
   */
  function hapticOf(source: Source): HapticPattern {
    // An entry may raise its preset from its own words; a bare patch and a
    // name resolved to a patch have no words, so they stay acoustic.
    if (typeof source === 'object' && 'patch' in source) return api.haptic(source);
    if (typeof source === 'string') {
      const entry = api.get(source);
      if (entry) return api.haptic(entry);
    }
    return api.haptic(resolve(source).patch);
  }

  function uriFor(source: Source, tweakOptions: Tweak = {}): string {
    const { name } = resolve(source);
    return cacheDir + fileName(name, tweakOptions);
  }

  async function prepare(source: Source, tweakOptions: Tweak = {}): Promise<string> {
    const { patch } = resolve(source);
    const uri = uriFor(source, tweakOptions);

    const running = inFlight.get(uri);
    if (running) return running;

    const work = (async (): Promise<string> => {
      if (await fileExists(uri)) return uri;
      const wav = api.wav(api.tweak(patch, tweakOptions));
      await writeFile(uri, toBase64(wav));
      return uri;
    })();

    inFlight.set(uri, work);
    try {
      return await work;
    } catch (error) {
      // A failed write must not be remembered as done. The next call
      // should try again rather than play a file that is not there.
      inFlight.delete(uri);
      throw error;
    }
  }

  return {
    sounds: api.sounds,
    search: (query, searchOptions) => api.search(query, searchOptions),
    find: (query, searchOptions) => api.find(query, searchOptions),
    get: (name) => api.get(name),
    categories: () => api.categories(),
    uriFor,
    prepare,

    async prepareAll(sources, tweakOptions) {
      return Promise.all(sources.map((source) => prepare(source, tweakOptions)));
    },

    haptic: hapticOf,

    async play(source, playOptions = {}) {
      const { haptic: wantsHaptic, hapticOnly, ...tweakOptions } = playOptions;

      if (wantsHaptic === true || hapticOnly === true) {
        // Fire it and do not wait. Awaiting the buzz before the sound
        // makes one event feel like two.
        void Promise.resolve(vibrate?.(hapticOf(source))).catch(() => {
          // A missing motor must never stop the sound.
        });
      }

      if (hapticOnly === true) return uriFor(source, tweakOptions);

      const uri = await prepare(source, tweakOptions);
      await playFile(uri);
      return uri;
    },

    clearMemo() {
      inFlight.clear();
    },
  };
}
