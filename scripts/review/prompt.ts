// The prompt for one candidate. Pure: the caller passes the style guide text,
// the library, and the rejected candidates.
import type { Patch, SoundEntry } from '../../src/library/types.js';
import type { RejectedLine, SlotLabel } from './types.js';

export const MAX_REFERENCES = 8;
export const MAX_REJECTED = 9;
export const MAX_KEYWORDS = 10;

// Three calls with one prompt can return one idea three times. A different
// direction for each slot gives the reviewer a real choice.
export const SLOT_HINTS: Record<SlotLabel, string> = {
  A: 'Write the most direct, literal reading of the phrase.',
  B: 'Take a different sonic approach: a different primary waveform, or a different layer structure (noise-led where the obvious answer is tone-led, or the reverse).',
  C: 'Write a simpler sound: fewer layers, less movement.',
};

export function buildSystemPrompt(styleGuide: string): string {
  return [
    'You write one sound for a curated library of short UI sounds. Every sound follows the style guide below.',
    '',
    '<style_guide>',
    styleGuide.trim(),
    '</style_guide>',
    '',
    'Return two fields.',
    '- concept: one or two sentences. Name what carries the idea. Write it before the patch.',
    '- patch: the synthesis settings, as 1 to 4 layers. Every sound in this library is made only from these layers; there is no audio file.',
    '',
    'Set every field of every layer. Where a layer needs no filter and no pitch sweep, send null for it rather than leaving it out.',
  ].join('\n');
}

/** Up to 8 entries from the same category, then the first entries of the library. */
export function pickReferences(target: SoundEntry, library: SoundEntry[]): SoundEntry[] {
  const others = library.filter((entry) => entry.name !== target.name);
  const same = others.filter((entry) => entry.category === target.category);
  const fill = others.filter((entry) => entry.category !== target.category);
  return [...same, ...fill].slice(0, MAX_REFERENCES);
}

const tag = (name: string, text: string): string => `<${name}>${text}</${name}>`;

export function buildUserMessage(input: {
  target: SoundEntry;
  references: SoundEntry[];
  rejected: RejectedLine[];
  slot: SlotLabel;
}): string {
  const { target, references, slot } = input;
  const rejected = input.rejected
    .filter((line) => line.name === target.name)
    .sort((a, b) => b.rejectedAt.localeCompare(a.rejectedAt))
    .slice(0, MAX_REJECTED);

  const parts = [
    'Reference sounds from the library, in the target style:',
    ...references.map((ref) =>
      [
        '<reference>',
        tag('phrase', ref.phrase),
        tag('concept', ref.concept),
        tag('patch', JSON.stringify(ref.patch)),
        '</reference>',
      ].join('\n'),
    ),
    '',
    'Write a new sound for this library entry:',
    tag('phrase', target.phrase),
    tag('category', target.category),
    tag('keywords', target.keywords.slice(0, MAX_KEYWORDS).join(', ')),
  ];
  if (rejected.length > 0) {
    parts.push('', 'A reviewer rejected these sounds. Do not repeat their idea.');
    for (const line of rejected) {
      parts.push(
        [
          '<rejected>',
          tag('concept', line.concept),
          tag('patch', JSON.stringify(line.patch)),
          tag('reason', line.reason.trim() || 'no reason given'),
          '</rejected>',
        ].join('\n'),
      );
    }
  }
  parts.push('', `Direction for this sound: ${SLOT_HINTS[slot]}`);
  return parts.join('\n');
}

export function buildRetryMessage(
  first: string,
  candidate: { concept: string; patch: Patch },
  problems: string[],
): string {
  return [
    first,
    '',
    'Your previous sound failed the checker:',
    ...problems.map((problem) => `- ${problem}`),
    tag('previous_concept', candidate.concept),
    tag('previous_patch', JSON.stringify(candidate.patch)),
    'Write it again so it passes. Keep the same concept unless the concept caused the problem.',
  ].join('\n');
}
