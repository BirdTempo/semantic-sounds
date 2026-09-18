// A generator that costs nothing, for manual work and end-to-end tests.
// Turn it on with REVIEW_FAKE_DRAW=1. It fails about one call in six, so the
// failure paths get exercised too.
import type { Patch } from '../../src/library/types.js';
import type { DrawRequest, DrawResult, SlotLabel } from './types.js';

const WAVES = ['sine', 'triangle', 'sine', 'triangle'] as const;
const SLOT_ORDER: Record<SlotLabel, number> = { A: 0, B: 1, C: 2 };
const FAKE_MODEL = 'fake-draw';

/** A patch that passes the contract, varied a little by slot and call. */
export function fakePatch(slot: SlotLabel, seed: number): Patch {
  const index = SLOT_ORDER[slot];
  const freqHz = 420 + index * 90 + (seed % 3) * 25;
  return {
    layers: [
      {
        source: { type: 'oscillator', wave: WAVES[(index + seed) % WAVES.length]!, freqHz },
        envelope: { attackMs: 12 + index * 2, decayMs: 40, sustainLevel: 0.3, sustainMs: 30, releaseMs: 50 },
        gain: 0.45,
      },
    ],
  };
}

export function createFakeDraw(random: () => number = Math.random): (request: DrawRequest) => Promise<DrawResult> {
  let calls = 0;
  return async ({ slot }) => {
    const seed = calls++;
    await new Promise((resolve) => setTimeout(resolve, 500 + random() * 2500));
    if (random() < 1 / 6) return { ok: false, error: 'the fake generator failed on purpose' };
    return {
      ok: true,
      candidate: {
        concept: `A fake ${slot} sound, written by the fake generator for local testing.`,
        patch: fakePatch(slot, seed),
        model: FAKE_MODEL,
      },
    };
  };
}
