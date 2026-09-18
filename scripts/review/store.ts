// File access for the review tool. Every path comes from `root`, so the tests
// can run against a temp copy of the repository layout.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Patch, SoundEntry } from '../../src/library/types.js';
import { checkEntry } from '../../src/library/validate.js';
import type { RejectedLine, SessionFile } from './types.js';

export type Store = {
  /** Every library entry, in batch-file order and then entry order. */
  listEntries(): SoundEntry[];
  /** Replace `concept` and `patch` on one entry. Returns the problems, or an empty list on success. */
  replaceCandidate(name: string, candidate: { concept: string; patch: Patch }): string[];
  readRejected(): RejectedLine[];
  appendRejected(lines: RejectedLine[]): void;
  readSession(): SessionFile;
  writeSession(session: SessionFile): void;
};

/** Write through a temp file and a rename, so a reader never sees half a file. */
function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, text);
  renameSync(temp, path);
}

export function createStore(root: string): Store {
  const soundsDir = join(root, 'src/library/sounds');
  const rejectedPath = join(root, 'scripts/review/rejected.jsonl');
  const sessionPath = join(root, 'scripts/review/session.json');

  const batchFiles = (): string[] =>
    readdirSync(soundsDir)
      .filter((file) => file.endsWith('.json'))
      .sort()
      .map((file) => join(soundsDir, file));

  const readBatch = (path: string): { text: string; entries: SoundEntry[] } => {
    const text = readFileSync(path, 'utf8');
    try {
      return { text, entries: JSON.parse(text) as SoundEntry[] };
    } catch (error) {
      throw new Error(`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return {
    listEntries: () => batchFiles().flatMap((path) => readBatch(path).entries),

    replaceCandidate(name, candidate) {
      for (const path of batchFiles()) {
        const { text, entries } = readBatch(path);
        const index = entries.findIndex((entry) => entry.name === name);
        if (index === -1) continue;
        const updated: SoundEntry = { ...entries[index]!, concept: candidate.concept, patch: candidate.patch };
        const problems = checkEntry(updated);
        if (problems.length > 0) return problems;
        entries[index] = updated;
        // Keep the final newline as found, so the diff shows only the changed lines.
        writeAtomic(path, JSON.stringify(entries, null, 2) + (text.endsWith('\n') ? '\n' : ''));
        return [];
      }
      return [`no library entry is named "${name}"`];
    },

    readRejected() {
      if (!existsSync(rejectedPath)) return [];
      return readFileSync(rejectedPath, 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as RejectedLine);
    },

    appendRejected(lines) {
      if (lines.length === 0) return;
      mkdirSync(dirname(rejectedPath), { recursive: true });
      appendFileSync(rejectedPath, lines.map((line) => `${JSON.stringify(line)}\n`).join(''));
    },

    readSession() {
      if (!existsSync(sessionPath)) return { open: [] };
      return JSON.parse(readFileSync(sessionPath, 'utf8')) as SessionFile;
    },

    writeSession(session) {
      writeAtomic(sessionPath, `${JSON.stringify(session, null, 2)}\n`);
    },
  };
}
