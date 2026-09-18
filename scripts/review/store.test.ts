import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { makeFixture, sampleEntry, type Fixture } from './fixture.js';
import { createStore } from './store.js';

let fixture: Fixture | null = null;
afterEach(() => {
  fixture?.cleanup();
  fixture = null;
});

const soundsFile = (root: string, name: string) => join(root, 'src', 'library', 'sounds', `${name}.json`);

describe('createStore', () => {
  it('lists entries across batch files in file then entry order', () => {
    fixture = makeFixture({
      'a-batch': [sampleEntry({ name: 'one', phrase: 'one' }), sampleEntry({ name: 'two', phrase: 'two' })],
      'b-batch': [sampleEntry({ name: 'three', phrase: 'three' })],
    });
    const names = createStore(fixture.root)
      .listEntries()
      .map((entry) => entry.name);
    expect(names).toEqual(['one', 'two', 'three']);
  });

  it('replaces a candidate in whichever file holds it', () => {
    fixture = makeFixture({ 'a-batch': [sampleEntry({ name: 'one', phrase: 'one' })] });
    const store = createStore(fixture.root);
    const patch = {
      layers: [
        {
          source: { type: 'oscillator' as const, wave: 'triangle' as const, freqHz: 500 },
          envelope: { attackMs: 12, decayMs: 30, sustainLevel: 0.2, sustainMs: 20, releaseMs: 30 },
          gain: 0.5,
        },
      ],
    };
    const problems = store.replaceCandidate('one', { concept: 'A replacement sound for this entry.', patch });
    expect(problems).toEqual([]);
    const written = JSON.parse(readFileSync(soundsFile(fixture.root, 'a-batch'), 'utf8'));
    expect(written[0].concept).toBe('A replacement sound for this entry.');
    expect(written[0].patch.layers[0].source.wave).toBe('triangle');
  });

  it('refuses a candidate that fails the library check and writes nothing', () => {
    fixture = makeFixture({ 'a-batch': [sampleEntry({ name: 'one', phrase: 'one' })] });
    const store = createStore(fixture.root);
    const before = readFileSync(soundsFile(fixture.root, 'a-batch'), 'utf8');
    // 10s of envelope is far past the 1500ms contract limit.
    const problems = store.replaceCandidate('one', {
      concept: 'A replacement sound that runs much too long for the contract.',
      patch: {
        layers: [
          {
            source: { type: 'oscillator', wave: 'sine', freqHz: 500 },
            envelope: { attackMs: 2000, decayMs: 2000, sustainLevel: 0.5, sustainMs: 4000, releaseMs: 2000 },
            gain: 0.5,
          },
        ],
      },
    });
    expect(problems.some((problem) => problem.includes('duration'))).toBe(true);
    expect(readFileSync(soundsFile(fixture.root, 'a-batch'), 'utf8')).toBe(before);
  });

  it('reports a name that is in no batch file', () => {
    fixture = makeFixture({ 'a-batch': [sampleEntry({ name: 'one', phrase: 'one' })] });
    const problems = createStore(fixture.root).replaceCandidate('missing', {
      concept: 'A replacement sound for this entry.',
      patch: sampleEntry().patch,
    });
    expect(problems).toEqual(['no library entry is named "missing"']);
  });

  it('preserves each file trailing-newline convention', () => {
    fixture = makeFixture({ 'no-newline': [sampleEntry({ name: 'one', phrase: 'one' })] }, false);
    const store = createStore(fixture.root);
    store.replaceCandidate('one', { concept: 'A replacement sound for this entry.', patch: sampleEntry().patch });
    expect(readFileSync(soundsFile(fixture.root, 'no-newline'), 'utf8').endsWith('\n')).toBe(false);
  });

  it('appends rejected lines and reads them back', () => {
    fixture = makeFixture({ 'a-batch': [sampleEntry({ name: 'one', phrase: 'one' })] });
    const store = createStore(fixture.root);
    expect(store.readRejected()).toEqual([]);
    const line = {
      id: 'id-1',
      name: 'one',
      phrase: 'one',
      category: 'ui-feedback',
      concept: 'A rejected sound.',
      patch: sampleEntry().patch,
      reason: 'too harsh',
      origin: 'library' as const,
      model: null,
      round: 0,
      rejectedAt: '2026-09-19T00:00:00.000Z',
    };
    store.appendRejected([line]);
    store.appendRejected([{ ...line, id: 'id-2' }]);
    expect(store.readRejected().map((entry) => entry.id)).toEqual(['id-1', 'id-2']);
  });

  it('round-trips the session file and defaults to empty', () => {
    fixture = makeFixture({ 'a-batch': [sampleEntry({ name: 'one', phrase: 'one' })] });
    const store = createStore(fixture.root);
    expect(store.readSession()).toEqual({ open: [] });
    store.writeSession({ open: [{ name: 'one', round: 1, startedAt: 'now', slots: [] }] });
    expect(store.readSession().open[0]?.name).toBe('one');
  });
});
