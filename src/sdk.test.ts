import { describe, it, expect, vi } from 'vitest';
import { createSemanticSounds } from './sdk';
import { sounds } from './library/index';
import type { Patch } from './library/index';

const BARE_PATCH: Patch = {
  layers: [
    {
      source: { type: 'oscillator', wave: 'sine', freqHz: 440 },
      envelope: { attackMs: 5, decayMs: 40, sustainLevel: 0.3, sustainMs: 30, releaseMs: 60 },
      gain: 0.6,
    },
  ],
};

/** A response body shaped like the generation endpoint of sub-project 5. */
function generationResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe('createSemanticSounds', () => {
  it('holds the whole curated set', () => {
    const api = createSemanticSounds();
    expect(api.sounds.length).toBe(sounds.length);
    expect(api.sounds.length).toBeGreaterThanOrEqual(1000);
  });

  it('finds a sound from plain prose', () => {
    const api = createSemanticSounds();
    expect(api.find('the file finished uploading')?.name).toBe('upload-complete');
  });

  it('gives null for prose the set does not answer', () => {
    const api = createSemanticSounds();
    expect(api.find('quantum entanglement')).toBeNull();
  });

  it('ranks with search and keeps the scores', () => {
    const api = createSemanticSounds();
    const matches = api.search('the file finished uploading', { limit: 3 });
    expect(matches.length).toBe(3);
    expect(matches[0]?.sound.name).toBe('upload-complete');
    expect(matches[0]!.score).toBeGreaterThan(matches[2]!.score);
  });

  it('gives the same results for the same query twice', () => {
    const api = createSemanticSounds();
    const first = api.search('a dog barking', { limit: 5 }).map((m) => m.sound.name);
    const second = api.search('a dog barking', { limit: 5 }).map((m) => m.sound.name);
    expect(second).toEqual(first);
  });

  it('gets one sound by its stable name', () => {
    const api = createSemanticSounds();
    expect(api.get('upload-complete')?.phrase).toBe('upload complete');
    expect(api.get('no-such-sound')).toBeNull();
  });

  it('lists every category, sorted and unique', () => {
    const api = createSemanticSounds();
    const names = api.categories();
    expect(names).toEqual([...names].sort());
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('ui-feedback');
  });

  it('puts every sound in exactly one listed category', () => {
    const api = createSemanticSounds();
    const total = api.categories().reduce((sum, name) => sum + api.inCategory(name).length, 0);
    expect(total).toBe(api.sounds.length);
    expect(api.inCategory('no-such-category')).toEqual([]);
  });

  it('renders an entry and a bare patch alike', () => {
    const api = createSemanticSounds();
    const entry = api.get('upload-complete')!;
    expect(api.render(entry).length).toBeGreaterThan(0);
    expect(api.render(BARE_PATCH).length).toBeGreaterThan(0);
    // The same patch, passed either way, gives the same samples.
    expect([...api.render(entry)]).toEqual([...api.render(entry.patch)]);
  });

  it('renders at a requested sample rate', () => {
    const api = createSemanticSounds();
    const full = api.render(BARE_PATCH);
    const half = api.render(BARE_PATCH, 24000);
    expect(half.length).toBe(Math.round(full.length / 2));
  });

  it('encodes a WAV file that starts with RIFF', () => {
    const api = createSemanticSounds();
    const bytes = api.wav(api.get('upload-complete')!);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF');
    expect(bytes.byteLength).toBeGreaterThan(44);
  });

  it('reports a duration that agrees with the render length', () => {
    const api = createSemanticSounds();
    const entry = api.get('upload-complete')!;
    const fromSamples = (api.render(entry).length / 48000) * 1000;
    expect(Math.abs(api.durationMs(entry) - fromSamples)).toBeLessThan(1);
    expect(api.durationMs(BARE_PATCH)).toBe(135);
  });

  it('resolves an owned phrase from the curated set', async () => {
    const api = createSemanticSounds();
    const result = await api.resolve('the file finished uploading');
    expect(result.origin).toBe('curated');
    expect(result.sound?.name).toBe('upload-complete');
    expect(result.score).toBeGreaterThan(0);
    expect(result.patch).toBe(result.sound?.patch);
  });

  it('calls the generation endpoint when the set has no answer', async () => {
    const fetchImpl = vi.fn(async () => generationResponse({ patch: BARE_PATCH }));
    const api = createSemanticSounds({
      functionUrl: 'https://example.invalid/generate',
      apiKey: 'test-key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await api.resolve('quantum entanglement');
    expect(result.origin).toBe('generated');
    expect(result.patch).toEqual(BARE_PATCH);
    expect(result.sound).toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://example.invalid/generate');
    expect(JSON.parse(String(init.body))).toEqual({ phrase: 'quantum entanglement' });
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
  });

  it('does not call the endpoint when the set answers', async () => {
    const fetchImpl = vi.fn(async () => generationResponse({ patch: BARE_PATCH }));
    const api = createSemanticSounds({
      functionUrl: 'https://example.invalid/generate',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await api.resolve('the file finished uploading');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('names the phrase when nothing answers and no endpoint is set', async () => {
    const api = createSemanticSounds();
    await expect(api.resolve('quantum entanglement')).rejects.toThrow(/quantum entanglement/);
    await expect(api.resolve('quantum entanglement')).rejects.toThrow(/functionUrl/);
  });

  it('reports the endpoint error message, not a status code alone', async () => {
    const fetchImpl = vi.fn(async () => generationResponse({ error: 'the model refused' }, 422));
    const api = createSemanticSounds({
      functionUrl: 'https://example.invalid/generate',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(api.resolve('quantum entanglement')).rejects.toThrow('the model refused');
  });

  it('rejects an endpoint response that carries no patch', async () => {
    const fetchImpl = vi.fn(async () => generationResponse({ ok: true }));
    const api = createSemanticSounds({
      functionUrl: 'https://example.invalid/generate',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(api.resolve('quantum entanglement')).rejects.toThrow(/no patch/);
  });

  it('honours a raised minScore by sending more phrases to the endpoint', async () => {
    const fetchImpl = vi.fn(async () => generationResponse({ patch: BARE_PATCH }));
    const api = createSemanticSounds({
      minScore: 100000,
      functionUrl: 'https://example.invalid/generate',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await api.resolve('the file finished uploading');
    expect(result.origin).toBe('generated');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
