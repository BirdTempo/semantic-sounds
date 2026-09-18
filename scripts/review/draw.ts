// One candidate: ask the model, check the result against the library
// contract, and retry once with the problems. Only a candidate that passed
// `checkEntry` reaches the page or the set.
import type { Patch, SoundEntry } from '../../src/library/types.js';
import { checkEntry } from '../../src/library/validate.js';
import type { AskModel, ModelRequest } from './anthropic.js';
import { buildRetryMessage } from './prompt.js';
import type { DrawResult } from './types.js';

/**
 * Check a candidate as the library would see it. The target's own metadata
 * (name, keywords, category) is already valid, so every problem reported
 * here comes from the new concept or patch.
 */
export function candidateProblems(target: SoundEntry, candidate: { concept: string; patch: Patch }): string[] {
  return checkEntry({ ...target, concept: candidate.concept, patch: candidate.patch });
}

export async function drawSound(ask: AskModel, target: SoundEntry, request: ModelRequest): Promise<DrawResult> {
  let user = request.user;
  let problems: string[] = [];
  try {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const reply = await ask({ system: request.system, user });
      if (reply.kind === 'refusal') {
        return { ok: false, error: `the model declined to write this sound (${reply.model})` };
      }
      const candidate = { concept: reply.concept.trim(), patch: reply.patch };
      problems = candidateProblems(target, candidate);
      if (problems.length === 0) return { ok: true, candidate: { ...candidate, model: reply.model } };
      user = buildRetryMessage(request.user, candidate, problems);
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  return { ok: false, error: `the sound failed the check twice: ${problems.join('; ')}` };
}
