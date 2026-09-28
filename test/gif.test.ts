import { readFileSync } from 'node:fs';
import { GifReader, GifWriter, type FrameOptions } from 'omggif';
import { describe, expect, it } from 'vitest';
import { clipRect, decodeGifFrames } from '../src/formats/gif.js';

interface TestFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  pixels: number[];
  opts?: FrameOptions;
}

/**
 * Write a GIF. The palette maps index k to red = k * 8, and index 31 to
 * white, so decoded pixels show which frame pixel landed where.
 */
function makeGif(width: number, height: number, frames: TestFrame[]): Uint8Array {
  const palette = Array.from({ length: 32 }, (_, k) => (k === 31 ? 0xffffff : (k * 8) << 16));
  const buf = new Uint8Array(4096);
  const writer = new GifWriter(buf, width, height, { palette, loop: 0 });
  for (const f of frames) writer.addFrame(f.x, f.y, f.width, f.height, f.pixels, { delay: 2, ...f.opts });
  return buf.slice(0, writer.end());
}

const pixel = (data: Uint8Array, width: number, x: number, y: number): number[] =>
  Array.from(data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4));

describe('GIF frames outside the logical screen', () => {
  it('clips a frame that sticks out on the right instead of wrapping it', () => {
    // 4x2 screen, 4x2 white frame at x = 2: half of it is off screen.
    const [frame] = decodeGifFrames(makeGif(4, 2, [{ x: 2, y: 0, width: 4, height: 2, pixels: new Array(8).fill(31) }]));
    for (let y = 0; y < 2; y++) {
      expect(pixel(frame!.data, 4, 0, y), `(0, ${y})`).toEqual([0, 0, 0, 0]);
      expect(pixel(frame!.data, 4, 1, y), `(1, ${y})`).toEqual([0, 0, 0, 0]);
      expect(pixel(frame!.data, 4, 2, y)).toEqual([255, 255, 255, 255]);
      expect(pixel(frame!.data, 4, 3, y)).toEqual([255, 255, 255, 255]);
    }
  });

  it('places an offset frame that is larger than the screen pixel for pixel', () => {
    // 3x3 screen, 5x4 frame at (1, 1). Frame pixel (fx, fy) has index fy * 5 + fx.
    const pixels = Array.from({ length: 20 }, (_, i) => i);
    const [frame] = decodeGifFrames(makeGif(3, 3, [{ x: 1, y: 1, width: 5, height: 4, pixels }]));
    expect(frame!.data).toHaveLength(3 * 3 * 4);
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        const expected = x >= 1 && y >= 1 ? [((y - 1) * 5 + (x - 1)) * 8, 0, 0, 255] : [0, 0, 0, 0];
        expect(pixel(frame!.data, 3, x, y), `(${x}, ${y})`).toEqual(expected);
      }
    }
  });

  it('ignores a frame that is entirely off screen', () => {
    const frames = decodeGifFrames(
      makeGif(2, 2, [
        { x: 0, y: 0, width: 2, height: 2, pixels: [5, 5, 5, 5] },
        { x: 10, y: 10, width: 2, height: 2, pixels: [31, 31, 31, 31] },
      ]),
    );
    expect(frames).toHaveLength(2);
    expect(Array.from(frames[1]!.data)).toEqual(Array.from(frames[0]!.data));
  });

  it('clears only the on-screen part of an overflowing frame on disposal 2', () => {
    const frames = decodeGifFrames(
      makeGif(4, 2, [
        { x: 0, y: 0, width: 4, height: 2, pixels: new Array(8).fill(5) },
        { x: 2, y: 0, width: 4, height: 2, pixels: new Array(8).fill(31), opts: { disposal: 2 } },
        { x: 0, y: 0, width: 1, height: 1, pixels: [5] },
      ]),
    );
    const last = frames[2]!.data;
    expect(pixel(last, 4, 1, 1)).toEqual([40, 0, 0, 255]);
    expect(pixel(last, 4, 2, 0)).toEqual([0, 0, 0, 0]);
    expect(pixel(last, 4, 3, 1)).toEqual([0, 0, 0, 0]);
  });

  it('decodes ordinary GIFs exactly as omggif blits them', () => {
    const bytes = readFileSync(new URL('../examples/orbit.gif', import.meta.url));
    const reader = new GifReader(bytes);
    const canvas = new Uint8Array(reader.width * reader.height * 4);
    const frames = decodeGifFrames(bytes);
    for (let i = 0; i < reader.numFrames(); i++) {
      reader.decodeAndBlitFrameRGBA(i, canvas);
      expect(Buffer.compare(Buffer.from(frames[i]!.data), Buffer.from(canvas)), `frame ${i}`).toBe(0);
    }
  });
});

describe('clipRect', () => {
  it('clips negative offsets and oversized frames to the screen', () => {
    expect(clipRect({ x: -2, y: -1, width: 5, height: 5 }, 4, 2)).toEqual({ x0: 0, y0: 0, x1: 3, y1: 2 });
    expect(clipRect({ x: 1, y: 1, width: 10, height: 10 }, 4, 2)).toEqual({ x0: 1, y0: 1, x1: 4, y1: 2 });
  });

  it('returns an empty rectangle for frames off the screen', () => {
    const off = clipRect({ x: 10, y: 0, width: 2, height: 2 }, 4, 2);
    expect(off.x1 - off.x0).toBe(0);
    const left = clipRect({ x: -5, y: 0, width: 2, height: 2 }, 4, 2);
    expect(left.x1 - left.x0).toBe(0);
  });
});
