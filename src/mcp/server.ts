// The semantic-sounds MCP server.
//
// It gives an assistant a 1090-sound set that answers plain prose, and an
// optional path to write a new sound when the set has no answer.
//
//   npx -y semantic-sounds-mcp
//
// Environment:
//   SEMANTIC_SOUNDS_FUNCTION_URL  the generation endpoint
//   SEMANTIC_SOUNDS_API_KEY       the bearer token for that endpoint
//   SEMANTIC_SOUNDS_MIN_SCORE     the curated score needed to skip the model
//
// Without a function URL the server stays offline and answers from the
// curated set only. `resolve_sound` then reports that it is not configured.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createSemanticSounds, type SemanticSounds, type SemanticSoundsOptions } from '../sdk.js';
import type { Patch, SoundEntry, SoundMatch } from '../library/index.js';

export const SERVER_NAME = 'semantic-sounds';
export const SERVER_VERSION = '0.1.0';

/**
 * A preview renders at half the render rate.
 *
 * A 500ms sound at 48000 Hz in 16-bit mono is 48000 bytes, about 64 KB as
 * base64. That is a lot to put in a conversation. 24000 Hz halves it and
 * loses almost nothing: MAX_FREQ_HZ in the contract is 8000, so every
 * oscillator stays below the 12000 Hz limit of this rate. Only a noise
 * layer has energy above it, so a noisy sound previews a little duller
 * than it renders. The patch in the same result always describes the full
 * 48000 Hz render.
 */
export const PREVIEW_SAMPLE_RATE = 24000;

type TextBlock = { type: 'text'; text: string };
type AudioBlock = { type: 'audio'; data: string; mimeType: 'audio/wav' };
type ToolResult = { content: (TextBlock | AudioBlock)[] };

/** One text block, the shape every tool result starts from. */
function text(body: string): ToolResult {
  return { content: [{ type: 'text', text: body }] };
}

/**
 * The lines that tell a caller what to do with a patch. Every result that
 * carries a patch carries this too, so the model does not invent an API.
 */
const USAGE = [
  'Use it like this:',
  '',
  "  import { renderPatch } from 'semantic-sounds';",
  '  const samples = renderPatch(patch);   // Float32Array, mono, 48000 Hz',
  '',
  "  import { encodeWav } from 'semantic-sounds';",
  '  const wav = encodeWav(samples);       // Uint8Array, a playable .wav file',
].join('\n');

/** One sound as a compact block: enough to choose, short enough to list. */
function line(sounds: SemanticSounds, sound: SoundEntry, score?: number): string {
  const head = score === undefined ? sound.name : `${sound.name}  (score ${score.toFixed(1)})`;
  return [
    head,
    `  phrase: ${sound.phrase}`,
    `  category: ${sound.category}`,
    `  duration: ${Math.round(sounds.durationMs(sound))}ms`,
    `  keywords: ${sound.keywords.join(', ')}`,
  ].join('\n');
}

function matchList(sounds: SemanticSounds, matches: SoundMatch[]): string {
  if (matches.length === 0) return 'No sound matched. Try fewer words, or a plainer noun.';
  return matches.map((match) => line(sounds, match.sound, match.score)).join('\n\n');
}

/** A patch as pretty JSON, with the usage lines under it. */
function patchBlock(patch: Patch): string {
  return `${JSON.stringify(patch, null, 2)}\n\n${USAGE}`;
}

function preview(sounds: SemanticSounds, patch: Patch): AudioBlock {
  const bytes = sounds.wav(patch, PREVIEW_SAMPLE_RATE);
  return { type: 'audio', data: Buffer.from(bytes).toString('base64'), mimeType: 'audio/wav' };
}

/** Build the server. Exported so a test drives it with no transport. */
export function createServer(sounds: SemanticSounds = createSemanticSounds(fromEnvironment())): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    'search_sounds',
    {
      title: 'Search sounds',
      description:
        'Rank the curated sound set against a word, a phrase, or a whole sentence. ' +
        'Use plain prose: "my washing machine finished" answers as well as "washer done". ' +
        'Returns names and scores, not the patches. Call get_sound for a patch.',
      inputSchema: {
        query: z.string().min(1).describe('A word, a phrase, or a sentence.'),
        limit: z.number().int().min(1).max(50).optional().describe('How many results. Default 5.'),
      },
    },
    async ({ query, limit }) => text(matchList(sounds, sounds.search(query, { limit: limit ?? 5 }))),
  );

  server.registerTool(
    'get_sound',
    {
      title: 'Get a sound',
      description:
        'Return one sound by its stable name, with its patch as JSON. A patch is the artifact to keep: ' +
        'render it in the page with renderPatch, so no audio file ships. ' +
        'Take the name from search_sounds or list_category. ' +
        'Set preview to hear it: that adds a WAV audio block, rendered at 24000 Hz to keep it small.',
      inputSchema: {
        name: z.string().min(1).describe('The stable sound name, for example "upload-complete".'),
        preview: z.boolean().optional().describe('Attach a WAV preview. Default false, because audio is large.'),
      },
    },
    async ({ name, preview: wantsPreview }) => {
      const sound = sounds.get(name);
      if (sound === null) {
        return text(`No sound is named "${name}". Call search_sounds to find one.`);
      }
      const body = `${line(sounds, sound)}\n  concept: ${sound.concept}\n\n${patchBlock(sound.patch)}`;
      const result = text(body);
      if (wantsPreview === true) result.content.push(preview(sounds, sound.patch));
      return result;
    },
  );

  server.registerTool(
    'list_categories',
    {
      title: 'List categories',
      description: 'Every category in the curated set, with the sound count of each.',
      inputSchema: {},
    },
    async () => {
      const rows = sounds.categories().map((name) => `${name}  (${sounds.inCategory(name).length})`);
      return text(`${rows.length} categories, ${sounds.sounds.length} sounds\n\n${rows.join('\n')}`);
    },
  );

  server.registerTool(
    'list_category',
    {
      title: 'List one category',
      description: 'Every sound in one category. Call list_categories first for the names.',
      inputSchema: { category: z.string().min(1).describe('A category name, for example "ui-feedback".') },
    },
    async ({ category }) => {
      const found = sounds.inCategory(category);
      if (found.length === 0) return text(`No category is named "${category}". Call list_categories.`);
      return text(found.map((sound) => `${sound.name}  —  ${sound.phrase}`).join('\n'));
    },
  );

  server.registerTool(
    'resolve_sound',
    {
      title: 'Resolve a phrase to a sound',
      description:
        'Answer a phrase with a patch. The curated set answers first. When nothing scores high enough and ' +
        'a function URL is configured, the service writes a new patch. This is the one call to make when ' +
        'you only want a sound for an idea and do not care where it comes from. ' +
        'The result says whether the patch is curated or generated.',
      inputSchema: {
        phrase: z.string().min(1).describe('The idea to sound out, in plain words.'),
        preview: z.boolean().optional().describe('Attach a WAV preview. Default false, because audio is large.'),
      },
    },
    async ({ phrase, preview: wantsPreview }) => {
      try {
        const resolved = await sounds.resolve(phrase);
        const head =
          resolved.origin === 'curated'
            ? `curated: ${resolved.sound?.phrase} (${resolved.sound?.name}, score ${resolved.score?.toFixed(1)})`
            : 'generated by the model';
        const result = text(`${head}\n\n${patchBlock(resolved.patch)}`);
        if (wantsPreview === true) result.content.push(preview(sounds, resolved.patch));
        return result;
      } catch (error) {
        // A tool never throws. An assistant cannot read a stack trace, so
        // the cause comes back as the words of the answer.
        return text(error instanceof Error ? error.message : 'the sound could not be resolved');
      }
    },
  );

  return server;
}

/** Read the server options out of the environment. */
export function fromEnvironment(env: Record<string, string | undefined> = process.env): SemanticSoundsOptions {
  const options: SemanticSoundsOptions = {};
  if (env.SEMANTIC_SOUNDS_FUNCTION_URL) options.functionUrl = env.SEMANTIC_SOUNDS_FUNCTION_URL;
  if (env.SEMANTIC_SOUNDS_API_KEY) options.apiKey = env.SEMANTIC_SOUNDS_API_KEY;
  const score = Number(env.SEMANTIC_SOUNDS_MIN_SCORE);
  if (env.SEMANTIC_SOUNDS_MIN_SCORE && Number.isFinite(score) && score > 0) options.minScore = score;
  return options;
}
