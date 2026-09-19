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
} from './sdk';

export type { SoundEntry, SoundMatch, SearchOptions, Patch, Tweak };

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
  /** Render if needed, then play. Returns the file uri. */
  play(source: Source, options?: Tweak): Promise<string>;
  /** Where a sound's file goes. The same input always gives the same uri. */
  uriFor(source: Source, options?: Tweak): string;
  /** Forget what is cached in memory. The files stay on disk. */
  clearMemo(): void;
};

/** A sound entry, its stable name, or a bare patch. */
export type Source = SoundEntry | string | Patch;

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
  const { cacheDir, writeFile, fileExists, playFile } = options;
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

    async play(source, tweakOptions) {
      const uri = await prepare(source, tweakOptions);
      await playFile(uri);
      return uri;
    },

    clearMemo() {
      inFlight.clear();
    },
  };
}
