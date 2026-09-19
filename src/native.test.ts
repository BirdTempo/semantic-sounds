import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createNativeSounds, toBase64, type NativeOptions, type HapticPattern } from './native';
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
  vibrate: ReturnType<typeof vi.fn>;
  buzzed: HapticPattern[];
} {
  const written = new Map<string, string>();
  const played: string[] = [];
  const buzzed: HapticPattern[] = [];
  const writeFile = vi.fn(async (uri: string, base64: string) => void written.set(uri, base64));
  const playFile = vi.fn(async (uri: string) => void played.push(uri));
  const vibrate = vi.fn(async (pattern: HapticPattern) => void buzzed.push(pattern));
  return {
    cacheDir: 'file:///cache/semantic-sounds/',
    writeFile,
    fileExists: async (uri: string) => written.has(uri),
    playFile,
    vibrate,
    written,
    played,
    buzzed,
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

describe('vibration', () => {
  let deps: ReturnType<typeof stubs>;
  beforeEach(() => {
    deps = stubs();
  });

  it('does not vibrate unless asked', async () => {
    const api = createNativeSounds(deps);
    await api.play('tap');
    expect(deps.vibrate).not.toHaveBeenCalled();
  });

  it('vibrates and plays together', async () => {
    const api = createNativeSounds(deps);
    await api.play('tap', { haptic: true });
    await vi.waitFor(() => expect(deps.buzzed.length).toBe(1));
    expect(deps.played.length).toBe(1);
    expect(deps.buzzed[0]!.steps.length).toBeGreaterThan(0);
    expect(deps.buzzed[0]!.preset).toBe('selection');
  });

  it('vibrates without a sound when asked for that', async () => {
    const api = createNativeSounds(deps);
    await api.play('tap', { hapticOnly: true });
    await vi.waitFor(() => expect(deps.buzzed.length).toBe(1));
    expect(deps.playFile).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('raises a notification preset from the entry words', () => {
    const api = createNativeSounds(deps);
    expect(api.haptic('upload-complete').preset).toBe('notificationSuccess');
    expect(api.haptic('payment-declined').preset).toBe('notificationError');
  });

  it('keeps a bare patch acoustic, because it has no words', () => {
    const api = createNativeSounds(deps);
    const entry = api.get('upload-complete')!;
    expect(api.haptic(entry).preset).toBe('notificationSuccess');
    expect(api.haptic(entry.patch).preset).not.toContain('notification');
  });

  it('plays the sound even when the motor throws', async () => {
    const broken = stubs();
    broken.vibrate = vi.fn(async () => {
      throw new Error('no vibrator on this device');
    });
    const api = createNativeSounds(broken);
    await expect(api.play('tap', { haptic: true })).resolves.toContain('tap.wav');
    expect(broken.played.length).toBe(1);
  });

  it('does nothing when no vibrate adapter was given', async () => {
    const { vibrate: _drop, ...noMotor } = stubs();
    const api = createNativeSounds(noMotor);
    await expect(api.play('tap', { haptic: true })).resolves.toContain('tap.wav');
  });

  it('survives a destructured play, which a this-binding would not', async () => {
    const api = createNativeSounds(deps);
    const { play } = api;
    await play('tap', { haptic: true });
    await vi.waitFor(() => expect(deps.buzzed.length).toBe(1));
  });
});
