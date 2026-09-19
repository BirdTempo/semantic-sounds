import { RENDER_SAMPLE_RATE } from './types';

const HEADER_BYTES = 44;
const BITS_PER_SAMPLE = 16;
const CHANNELS = 1;
const FORMAT_PCM = 1;

function writeTag(view: DataView, offset: number, tag: string): void {
  for (let i = 0; i < tag.length; i++) view.setUint8(offset + i, tag.charCodeAt(i));
}

/**
 * Turn a rendered patch into a mono 16-bit PCM WAV file.
 *
 * The renderer gives a `Float32Array`, which no player reads. This is the
 * one step between a patch and a file, and the library keeps it so that
 * the page player, the review tool and the MCP server all write the same
 * bytes.
 *
 * 16 bits is enough for this set. The contract holds every sound at or
 * below -1 dBFS with an RMS between -20 and -14 dBFS, so the quietest
 * part of the set sits far above the noise floor of 16-bit audio.
 *
 * The result is a `Uint8Array`, not a Node `Buffer`: the library must
 * stay usable in a page.
 */
export function encodeWav(samples: Float32Array, sampleRate: number = RENDER_SAMPLE_RATE): Uint8Array {
  const dataBytes = samples.length * 2;
  const bytes = new Uint8Array(HEADER_BYTES + dataBytes);
  const view = new DataView(bytes.buffer);

  writeTag(view, 0, 'RIFF');
  view.setUint32(4, bytes.byteLength - 8, true);
  writeTag(view, 8, 'WAVE');

  writeTag(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, FORMAT_PCM, true);
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, (sampleRate * CHANNELS * BITS_PER_SAMPLE) / 8, true);
  view.setUint16(32, (CHANNELS * BITS_PER_SAMPLE) / 8, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);

  writeTag(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < samples.length; i++) {
    // Clamp first. An unclamped value wraps in setInt16, which turns a
    // loud sample into a loud sample of the opposite sign: a click.
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    // Two scales, not one. The signed 16-bit range is asymmetric, so
    // 32768 reaches the full negative end and 32767 keeps +1 in range.
    view.setInt16(HEADER_BYTES + i * 2, Math.round(clamped * (clamped < 0 ? 32768 : 32767)), true);
  }

  return bytes;
}
