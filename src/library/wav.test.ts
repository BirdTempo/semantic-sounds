import { describe, it, expect } from 'vitest';
import { encodeWav } from './wav';
import { RENDER_SAMPLE_RATE } from './types';

function tag(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + 4));
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Read one 16-bit sample back out of the data chunk. */
function sampleAt(bytes: Uint8Array, i: number): number {
  return view(bytes).getInt16(44 + i * 2, true);
}

describe('encodeWav', () => {
  it('writes the four RIFF tags at their fixed offsets', () => {
    const bytes = encodeWav(new Float32Array(8));
    expect(tag(bytes, 0)).toBe('RIFF');
    expect(tag(bytes, 8)).toBe('WAVE');
    expect(tag(bytes, 12)).toBe('fmt ');
    expect(tag(bytes, 36)).toBe('data');
  });

  it('sizes the file as one 44-byte header plus two bytes a sample', () => {
    const bytes = encodeWav(new Float32Array(100));
    expect(bytes.byteLength).toBe(44 + 200);
    // The RIFF size counts every byte after itself, and the data size
    // counts the samples only.
    expect(view(bytes).getUint32(4, true)).toBe(bytes.byteLength - 8);
    expect(view(bytes).getUint32(40, true)).toBe(200);
  });

  it('declares one channel of 16-bit PCM at the given rate', () => {
    const bytes = encodeWav(new Float32Array(4), 24000);
    const v = view(bytes);
    expect(v.getUint32(16, true)).toBe(16); // fmt chunk length
    expect(v.getUint16(20, true)).toBe(1); // format 1 = PCM
    expect(v.getUint16(22, true)).toBe(1); // channels
    expect(v.getUint32(24, true)).toBe(24000); // sample rate
    expect(v.getUint32(28, true)).toBe(24000 * 2); // byte rate
    expect(v.getUint16(32, true)).toBe(2); // block align
    expect(v.getUint16(34, true)).toBe(16); // bits a sample
  });

  it('defaults to the render sample rate', () => {
    const bytes = encodeWav(new Float32Array(4));
    expect(view(bytes).getUint32(24, true)).toBe(RENDER_SAMPLE_RATE);
  });

  it('carries a ramp back inside one step of 16-bit resolution', () => {
    const samples = new Float32Array(64);
    for (let i = 0; i < samples.length; i++) samples[i] = -1 + (2 * i) / (samples.length - 1);
    const bytes = encodeWav(samples);
    // A player decodes a 16-bit file by dividing by 32768, so that is how
    // the test reads it back. Two things move the value: rounding to the
    // nearest code, at most half a step, and the asymmetric scale, which
    // makes the positive half up to one step quiet. Together they stay
    // under 1.5 steps, which is -0.0003 dB and inaudible.
    for (let i = 0; i < samples.length; i++) {
      expect(Math.abs(sampleAt(bytes, i) / 32768 - samples[i]!)).toBeLessThan(1.5 / 32768);
    }
  });

  it('clamps above one instead of wrapping to a large negative value', () => {
    const bytes = encodeWav(Float32Array.from([1.5, 2, 1]));
    expect(sampleAt(bytes, 0)).toBe(32767);
    expect(sampleAt(bytes, 1)).toBe(32767);
    expect(sampleAt(bytes, 2)).toBe(32767);
  });

  it('reaches the full negative range at minus one', () => {
    const bytes = encodeWav(Float32Array.from([-1, -1.5]));
    expect(sampleAt(bytes, 0)).toBe(-32768);
    expect(sampleAt(bytes, 1)).toBe(-32768);
  });

  it('writes silence as zero', () => {
    const bytes = encodeWav(Float32Array.from([0, 0, 0]));
    expect(sampleAt(bytes, 0)).toBe(0);
    expect(sampleAt(bytes, 1)).toBe(0);
    expect(sampleAt(bytes, 2)).toBe(0);
  });

  it('gives a bare header for an empty input', () => {
    const bytes = encodeWav(new Float32Array(0));
    expect(bytes.byteLength).toBe(44);
    expect(view(bytes).getUint32(40, true)).toBe(0);
  });
});
