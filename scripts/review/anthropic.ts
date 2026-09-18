// The one model call, behind `AskModel`, so `draw.ts` and its tests never
// touch the SDK.
import type Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod/v4';
import type { Filter, Layer, Patch } from '../../src/library/types.js';

export const DEFAULT_MODEL = 'claude-opus-5';

// Every property is required and nullable rather than optional: a strict
// output schema is most reliable when the model always sends the key, and
// `normalizePatch` drops the nulls afterwards.
const EnvelopeSchema = z.object({
  attackMs: z.number(),
  decayMs: z.number(),
  sustainLevel: z.number(),
  sustainMs: z.number(),
  releaseMs: z.number(),
});

const FilterSchema = z.object({
  type: z.enum(['lowpass', 'highpass', 'bandpass']),
  cutoffHz: z.number(),
  q: z.number().nullable(),
});

const OscillatorSchema = z.object({
  type: z.literal('oscillator'),
  wave: z.enum(['sine', 'triangle', 'square', 'saw']),
  freqHz: z.number(),
  pitchEnvelope: z.object({ toHz: z.number(), timeMs: z.number() }).nullable(),
});

const NoiseSchema = z.object({
  type: z.literal('noise'),
  color: z.enum(['white', 'pink']),
});

const LayerSchema = z.object({
  source: z.discriminatedUnion('type', [OscillatorSchema, NoiseSchema]),
  envelope: EnvelopeSchema,
  filter: FilterSchema.nullable(),
  gain: z.number(),
});

const PatchSchema = z.object({ layers: z.array(LayerSchema).min(1).max(4) });

export const CandidateSchema = z.object({ concept: z.string(), patch: PatchSchema });

type RawPatch = z.infer<typeof PatchSchema>;

/** Drop the nulls, so the result matches the library's `Patch` type. */
export function normalizePatch(raw: RawPatch): Patch {
  return {
    layers: raw.layers.map((layer): Layer => {
      const source =
        layer.source.type === 'oscillator'
          ? {
              type: 'oscillator' as const,
              wave: layer.source.wave,
              freqHz: layer.source.freqHz,
              ...(layer.source.pitchEnvelope ? { pitchEnvelope: layer.source.pitchEnvelope } : {}),
            }
          : { type: 'noise' as const, color: layer.source.color };
      const filter: Filter | undefined = layer.filter
        ? {
            type: layer.filter.type,
            cutoffHz: layer.filter.cutoffHz,
            ...(layer.filter.q === null ? {} : { q: layer.filter.q }),
          }
        : undefined;
      return { source, envelope: layer.envelope, gain: layer.gain, ...(filter ? { filter } : {}) };
    }),
  };
}

export type ModelRequest = { system: string; user: string };
export type ModelReply =
  | { kind: 'candidate'; concept: string; patch: Patch; model: string }
  | { kind: 'refusal'; model: string };
export type AskModel = (request: ModelRequest) => Promise<ModelReply>;

export function createAskModel(client: Anthropic, model: string = DEFAULT_MODEL): AskModel {
  return async ({ system, user }) => {
    const response = await client.beta.messages.parse({
      model,
      max_tokens: 16000,
      // On a refusal, the API runs the same request on a fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: betaZodOutputFormat(CandidateSchema) },
      // The system prompt is the same for every call, so cache it.
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: user }],
    });
    if (response.stop_reason === 'refusal') return { kind: 'refusal', model: response.model };
    const output = response.parsed_output;
    if (!output) throw new Error(`the model returned no sound (stop_reason ${response.stop_reason})`);
    return { kind: 'candidate', concept: output.concept, patch: normalizePatch(output.patch), model: response.model };
  };
}

/** The key from the environment, else from the text of `.env` at the repository root. */
export function findApiKey(env: Record<string, string | undefined>, envFileText: string | null): string | null {
  const fromEnv = env.ANTHROPIC_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  for (const line of (envFileText ?? '').split('\n')) {
    const match = /^\s*ANTHROPIC_API_KEY\s*=\s*(.*)$/.exec(line);
    const value = match?.[1]?.trim().replace(/^["']|["']$/g, '');
    if (value) return value;
  }
  return null;
}
