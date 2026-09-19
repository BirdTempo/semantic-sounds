// A client for the sound set that needs no framework and no key.
//
//   import { createSemanticSounds } from 'semantic-sounds/sdk';
//
// The MCP server in `src/mcp/` sits on this surface. Search always runs in
// memory. A network call happens only when the curated set has no answer
// and a `functionUrl` is configured.
import { sounds } from './library/index';
import {
  createSoundIndex,
  searchIndex,
  LOCAL_MIN_SCORE,
  renderPatch,
  patchDurationMs,
  encodeWav,
  tweak as tweakPatch,
  RENDER_SAMPLE_RATE,
  type SearchOptions,
  type SoundEntry,
  type SoundMatch,
  type Patch,
  type Tweak,
} from './library/index';

export type { SoundEntry, SoundMatch, SearchOptions, Patch, Tweak };

/** Where a patch came from. */
export type SoundOrigin = 'curated' | 'generated';

/** One answer to a phrase. */
export type ResolvedSound = {
  /** The patch to render. This is the artifact to keep. */
  patch: Patch;
  /** Where the patch came from. */
  origin: SoundOrigin;
  /** The curated entry, when the curated set answered. */
  sound?: SoundEntry;
  /** The match score, when the curated set answered. */
  score?: number;
};

export type SemanticSoundsOptions = {
  /**
   * The generation endpoint. Omit it to stay offline: the client then
   * answers from the curated set only.
   */
  functionUrl?: string;
  /** A bearer token for that endpoint. */
  apiKey?: string;
  /**
   * The score a curated match needs before the client stops. Raise it to
   * send more phrases to the model. Default `LOCAL_MIN_SCORE`.
   */
  minScore?: number;
  /** Injected for tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
};

export type SemanticSounds = {
  /** Every curated sound. Read-only. */
  readonly sounds: readonly SoundEntry[];
  /** Rank the curated set against a word, a phrase, or a whole sentence. */
  search(query: string, options?: SearchOptions): SoundMatch[];
  /** The best curated sound for the prose, or null. */
  find(query: string, options?: SearchOptions): SoundEntry | null;
  /** One curated sound by its stable name, or null. */
  get(name: string): SoundEntry | null;
  /** Every category name, sorted. */
  categories(): string[];
  /** Every curated sound in one category. */
  inCategory(category: string): SoundEntry[];
  /** Render an entry or a bare patch to samples. */
  render(source: SoundEntry | Patch, sampleRate?: number): Float32Array;
  /** Render an entry or a bare patch to a mono 16-bit WAV file. */
  wav(source: SoundEntry | Patch, sampleRate?: number): Uint8Array;
  /** How long an entry or a bare patch plays, in milliseconds. */
  durationMs(source: SoundEntry | Patch): number;
  /**
   * A changed copy of a patch: `semitones` up or down, `stretch` longer or
   * shorter. Pitch and length move on their own, because this writes a new
   * patch rather than change how one plays.
   *
   *   const lower = sounds.tweak(entry, { semitones: -5 });
   *   sounds.wav(lower);
   */
  tweak(source: SoundEntry | Patch, options: Tweak): Patch;
  /**
   * Answer a phrase. The curated set answers first. When nothing scores
   * high enough and a `functionUrl` is set, the service writes a new
   * patch. Throws when no curated match exists and no endpoint is
   * configured.
   */
  resolve(phrase: string): Promise<ResolvedSound>;
};

/** Accept an entry or a bare patch everywhere a patch is wanted. */
function toPatch(source: SoundEntry | Patch): Patch {
  return 'patch' in source ? source.patch : source;
}

export function createSemanticSounds(options: SemanticSoundsOptions = {}): SemanticSounds {
  const { functionUrl, apiKey, minScore = LOCAL_MIN_SCORE, fetchImpl } = options;
  const entries = sounds as SoundEntry[];

  // The index costs a moment to build over 1090 sounds, so build it once
  // and only when the first search asks for it.
  let cached: ReturnType<typeof createSoundIndex> | null = null;
  const index = (): ReturnType<typeof createSoundIndex> => (cached ??= createSoundIndex(entries));

  let byName: Map<string, SoundEntry> | null = null;

  async function generate(phrase: string): Promise<ResolvedSound> {
    const call = fetchImpl ?? globalThis.fetch;
    if (functionUrl === undefined || typeof call !== 'function') {
      throw new Error(`no curated sound for "${phrase}", and no functionUrl is configured`);
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey !== undefined) headers.Authorization = `Bearer ${apiKey}`;

    const response = await call(functionUrl, { method: 'POST', headers, body: JSON.stringify({ phrase }) });
    const body: unknown = await response.json();
    const record = (body ?? {}) as Record<string, unknown>;
    if (!response.ok) {
      const message = typeof record.error === 'string' ? record.error : `HTTP ${response.status}`;
      throw new Error(message);
    }
    const patch = record.patch;
    if (patch === null || typeof patch !== 'object' || !Array.isArray((patch as Patch).layers)) {
      throw new Error('the service returned no patch');
    }
    return { patch: patch as Patch, origin: 'generated' };
  }

  return {
    sounds: entries as readonly SoundEntry[],

    search(query, searchOptions) {
      return searchIndex(index(), query, searchOptions);
    },

    find(query, searchOptions) {
      const best = searchIndex(index(), query, { minScore, ...searchOptions, limit: 1 })[0];
      return best?.sound ?? null;
    },

    get(name) {
      byName ??= new Map(entries.map((entry) => [entry.name, entry]));
      return byName.get(name) ?? null;
    },

    categories() {
      return [...new Set(entries.map((entry) => entry.category))].sort();
    },

    inCategory(category) {
      return entries.filter((entry) => entry.category === category);
    },

    render(source, sampleRate = RENDER_SAMPLE_RATE) {
      return renderPatch(toPatch(source), sampleRate);
    },

    wav(source, sampleRate = RENDER_SAMPLE_RATE) {
      return encodeWav(renderPatch(toPatch(source), sampleRate), sampleRate);
    },

    durationMs(source) {
      return patchDurationMs(toPatch(source));
    },

    tweak(source, options) {
      return tweakPatch(toPatch(source), options);
    },

    async resolve(phrase) {
      const best = searchIndex(index(), phrase, { limit: 1, minScore })[0];
      if (best !== undefined) {
        return { patch: best.sound.patch, origin: 'curated', sound: best.sound, score: best.score };
      }
      return generate(phrase);
    },
  };
}
