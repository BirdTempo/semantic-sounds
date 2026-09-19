import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createNativeSounds, toBase64, type NativeOptions } from './native';
import { sounds } from './library/index';
import { createSemanticSounds } from './sdk';

describe('toBase64', () => {
  it('agrees with Buffer on every tail length', () => {
    // 0, 1 and 2 bytes left over are the three padding cases.
    for (let length = 0; length < 64; length++) {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i++) bytes[i] = (i * 37 + 11) & 0xff;
      expect(toBase64(bytes), `length ${length}`).toBe(Buffer.from(bytes).toString('base64'));
    }
  });

  it('agrees with Buffer on every single byte value', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });

  it('agrees with Buffer on a real rendered wav file', () => {
    const wav = createSemanticSounds().wav(sounds[0]!);
    expect(wav.byteLength).toBeGreaterThan(1000);
    expect(toBase64(wav)).toBe(Buffer.from(wav).toString('base64'));
  });

  it('pads to a multiple of four', () => {
    for (let length = 1; length < 16; length++) {
      expect(toBase64(new Uint8Array(length)).length % 4, `length ${length}`).toBe(0);
    }
  });
});

/** A fake file system and player, so the tests need no device. */
function stubs(): NativeOptions & {
  written: Map<string, string>;
  played: string[];
  writeFile: ReturnType<typeof vi.fn>;
  playFile: ReturnType<typeof vi.fn>;
} {
  const written = new Map<string, string>();
  const played: string[] = [];
  const writeFile = vi.fn(async (uri: string, base64: string) => void written.set(uri, base64));
  const playFile = vi.fn(async (uri: string) => void played.push(uri));
  return {
    cacheDir: 'file:///cache/semantic-sounds/',
    writeFile,
    fileExists: async (uri: string) => written.has(uri),
    playFile,
    written,
    played,
  };
}

describe('createNativeSounds', () => {
  let deps: ReturnType<typeof stubs>;

  beforeEach(() => {
    deps = stubs();
  });

  it('holds the whole set by default', () => {
    expect(createNativeSounds(deps).sounds.length).toBe(sounds.length);
  });

  it('holds only the subset it is given', () => {
    const subset = sounds.filter((s) => ['tap', 'upload-complete'].includes(s.name));
    expect(subset.length).toBe(2);

    const api = createNativeSounds({ ...deps, sounds: subset });
    expect(api.sounds.length).toBe(2);
    expect(api.get('tap')?.name).toBe('tap');
    // A sound outside the subset is gone, which is the whole point.
    expect(api.get('dog-bark')).toBeNull();
    expect(api.find('a dog barking')).toBeNull();
  });

  it('searches by prose', () => {
    expect(createNativeSounds(deps).find('my washing machine finished')?.name).toBe('washer-done');
  });

  it('writes one wav file and plays it', async () => {
    const api = createNativeSounds(deps);
    const uri = await api.play('upload-complete');

    expect(uri).toBe('file:///cache/semantic-sounds/upload-complete.wav');
    expect(deps.written.size).toBe(1);
    expect(deps.played).toEqual([uri]);

    // The payload is a real wav file, not a placeholder.
    const bytes = Buffer.from(deps.written.get(uri)!, 'base64');
    expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
    expect(bytes.subarray(8, 12).toString()).toBe('WAVE');
    expect(bytes.readUInt16LE(34)).toBe(16); // bits a sample
  });

  it('renders once and reuses the file on the second play', async () => {
    const api = createNativeSounds(deps);
    await api.play('upload-complete');
    await api.play('upload-complete');
    expect(deps.writeFile).toHaveBeenCalledTimes(1);
    expect(deps.playFile).toHaveBeenCalledTimes(2);
  });

  it('renders once when two plays race in the same frame', async () => {
    const api = createNativeSounds(deps);
    await Promise.all([api.play('tap'), api.play('tap'), api.play('tap')]);
    expect(deps.writeFile).toHaveBeenCalledTimes(1);
    expect(deps.playFile).toHaveBeenCalledTimes(3);
  });

  it('gives a tweaked sound its own file, so it never collides', async () => {
    const api = createNativeSounds(deps);
    const plain = await api.play('upload-complete');
    const lower = await api.play('upload-complete', { semitones: -5 });
    const slow = await api.play('upload-complete', { stretch: 2 });

    expect(new Set([plain, lower, slow]).size).toBe(3);
    expect(lower).toContain('down5');
    expect(slow).toContain('x2');
    expect(deps.writeFile).toHaveBeenCalledTimes(3);

    // The stretched file really is longer.
    expect(Buffer.from(deps.written.get(slow)!, 'base64').length).toBeGreaterThan(
      Buffer.from(deps.written.get(plain)!, 'base64').length
    );
  });

  it('prepares without playing', async () => {
    const api = createNativeSounds(deps);
    const uri = await api.prepare('tap');
    expect(deps.written.has(uri)).toBe(true);
    expect(deps.playFile).not.toHaveBeenCalled();
  });

  it('prepares several at once', async () => {
    const api = createNativeSounds(deps);
    const uris = await api.prepareAll(['tap', 'upload-complete', 'error-buzz']);
    expect(uris.length).toBe(3);
    expect(deps.written.size).toBe(3);
  });

  it('accepts an entry and a bare patch, not only a name', async () => {
    const api = createNativeSounds(deps);
    const entry = api.get('upload-complete')!;
    expect(await api.play(entry)).toContain('upload-complete.wav');

    const bare = await api.play(entry.patch);
    // A bare patch has no name, so the file is named by its content.
    expect(bare).toMatch(/patch-[a-z0-9]+\.wav$/);
    // The same patch always gives the same file name.
    expect(await api.play(entry.patch)).toBe(bare);
  });

  it('names an unknown sound in the error, and says what to do', async () => {
    const api = createNativeSounds(deps);
    await expect(api.play('no-such-sound')).rejects.toThrow(/no-such-sound/);
    await expect(api.play('no-such-sound')).rejects.toThrow(/find\(\)/);
  });

  it('does not remember a failed write as done', async () => {
    const failing = stubs();
    let attempt = 0;
    failing.writeFile = vi.fn(async (uri: string, base64: string) => {
      attempt += 1;
      if (attempt === 1) throw new Error('disk full');
      failing.written.set(uri, base64);
    });
    const api = createNativeSounds(failing);

    await expect(api.play('tap')).rejects.toThrow('disk full');
    // The second call must try again, not resolve to a file that is absent.
    await expect(api.play('tap')).resolves.toContain('tap.wav');
    expect(failing.writeFile).toHaveBeenCalledTimes(2);
  });

  it('gives the uri without doing any work', () => {
    const api = createNativeSounds(deps);
    expect(api.uriFor('tap')).toBe('file:///cache/semantic-sounds/tap.wav');
    expect(api.uriFor('tap', { semitones: 3 })).toBe('file:///cache/semantic-sounds/tap-up3.wav');
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('skips the render when the file is already on disk from a past run', async () => {
    const api = createNativeSounds(deps);
    // Pretend a previous launch left the file behind.
    deps.written.set(api.uriFor('tap'), 'already-there');
    await api.play('tap');
    expect(deps.writeFile).not.toHaveBeenCalled();
    expect(deps.played.length).toBe(1);
  });
});
