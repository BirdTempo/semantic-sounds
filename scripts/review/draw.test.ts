import { describe, expect, it, vi } from 'vitest';
import type { AskModel, ModelReply } from './anthropic.js';
import { candidateProblems, drawSound } from './draw.js';
import { sampleEntry } from './fixture.js';

const target = sampleEntry();
const request = { system: 'SYSTEM', user: 'USER' };

const goodPatch = sampleEntry().patch;
const longPatch = {
  layers: [
    {
      source: { type: 'oscillator' as const, wave: 'sine' as const, freqHz: 500 },
      envelope: { attackMs: 2000, decayMs: 2000, sustainLevel: 0.5, sustainMs: 4000, releaseMs: 2000 },
      gain: 0.5,
    },
  ],
};

const reply = (overrides: Partial<Extract<ModelReply, { kind: 'candidate' }>> = {}): ModelReply => ({
  kind: 'candidate',
  concept: 'A short sharp click for a light tap.',
  patch: goodPatch,
  model: 'claude-opus-5',
  ...overrides,
});

describe('candidateProblems', () => {
  it('finds no problem in a candidate that meets the contract', () => {
    expect(candidateProblems(target, { concept: target.concept, patch: goodPatch })).toEqual([]);
  });

  it('reports a patch that breaks the contract', () => {
    const problems = candidateProblems(target, {
      concept: 'A very long sound that runs past the limit.',
      patch: longPatch,
    });
    expect(problems.some((problem) => problem.includes('duration'))).toBe(true);
  });

  it('reports a concept that is too short to explain the sound', () => {
    const problems = candidateProblems(target, { concept: 'Short.', patch: goodPatch });
    expect(problems.some((problem) => problem.includes('concept'))).toBe(true);
  });
});

describe('drawSound', () => {
  it('returns the candidate when the first answer passes', async () => {
    const ask: AskModel = vi.fn(async () => reply());
    const result = await drawSound(ask, target, request);
    expect(result).toEqual({
      ok: true,
      candidate: { concept: 'A short sharp click for a light tap.', patch: goodPatch, model: 'claude-opus-5' },
    });
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('retries once with the problems listed, then succeeds', async () => {
    const ask = vi.fn<AskModel>();
    ask.mockResolvedValueOnce(reply({ patch: longPatch }));
    ask.mockResolvedValueOnce(reply());
    const result = await drawSound(ask, target, request);
    expect(result.ok).toBe(true);
    expect(ask).toHaveBeenCalledTimes(2);
    const retry = ask.mock.calls[1]![0].user;
    expect(retry).toContain('USER');
    expect(retry).toContain('duration');
  });

  it('fails after a second bad answer and never retries again', async () => {
    const ask = vi.fn<AskModel>(async () => reply({ patch: longPatch }));
    const result = await drawSound(ask, target, request);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('failed the check twice');
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it('reports a refusal without retrying', async () => {
    const ask: AskModel = vi.fn(async () => ({ kind: 'refusal', model: 'claude-opus-5' }));
    const result = await drawSound(ask, target, request);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('declined');
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('turns a thrown error into a failed result', async () => {
    const ask: AskModel = vi.fn(async () => {
      throw new Error('network down');
    });
    const result = await drawSound(ask, target, request);
    expect(result).toEqual({ ok: false, error: 'network down' });
  });
});
