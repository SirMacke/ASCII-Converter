import { GifReader } from 'omggif';
import { MAX_PIXELS, checkPixels } from './limits.js';

/** One composited GIF frame: RGBA pixels plus how long to show it. */
export interface GifFrame {
  data: Uint8Array;
  width: number;
  height: number;
  /** Milliseconds. */
  delay: number;
}

export interface GifOptions {
  /** Only decode the first frame. */
  firstOnly?: boolean;
  /** Refuse images (or frames) with more pixels than this. Default 100 million. */
  maxPixels?: number;
}

/**
 * Decode the frames of a (possibly animated) GIF, composited the way a
 * browser shows them. Browser-safe: no Node APIs.
 */
export function decodeGifFrames(bytes: Uint8Array, options: GifOptions = {}): GifFrame[] {
  return Array.from(gifFrames(bytes, options));
}

/**
 * Like decodeGifFrames, but yields one frame at a time so a caller that
 * converts or scales each frame doesn't hold every full-size frame at once.
 */
export function* gifFrames(bytes: Uint8Array, options: GifOptions = {}): Generator<GifFrame, void, undefined> {
  const reader = new GifReader(bytes);
  const { width, height } = reader;
  const maxPixels = options.maxPixels ?? MAX_PIXELS;
  checkPixels(width, height, maxPixels);
  const count = options.firstOnly ? Math.min(1, reader.numFrames()) : reader.numFrames();
  if (count === 0) throw new Error('GIF contains no frames.');

  const infos = Array.from({ length: count }, (_, i) => reader.frameInfo(i));
  let maxW = 1;
  let maxH = 1;
  for (const info of infos) {
    checkPixels(info.width, info.height, maxPixels);
    maxW = Math.max(maxW, info.width);
    maxH = Math.max(maxH, info.height);
  }
  checkPixels(maxW, maxH, maxPixels);
  const frameReader = new GifReader(framesAtOrigin(bytes, infos, maxW, maxH));
  const scratch = new Uint8Array(maxW * maxH * 4);

  const canvas = new Uint8Array(width * height * 4);
  for (let i = 0; i < count; i++) {
    const info = infos[i]!;
    const previous = info.disposal === 3 ? canvas.slice() : undefined;

    // Decode the frame on its own (rows maxW apart), then copy the part
    // that lies on the logical screen. Blitting straight onto the screen
    // would wrap rows of a frame that sticks out past the right edge.
    scratch.fill(0, 0, maxW * info.height * 4);
    frameReader.decodeAndBlitFrameRGBA(i, scratch);
    const clip = clipRect(info, width, height);
    for (let y = clip.y0; y < clip.y1; y++) {
      let src = ((y - info.y) * maxW + (clip.x0 - info.x)) * 4;
      let dst = (y * width + clip.x0) * 4;
      for (let x = clip.x0; x < clip.x1; x++, src += 4, dst += 4) {
        // Transparent pixels leave whatever is underneath.
        if (scratch[src + 3] !== 0) canvas.set(scratch.subarray(src, src + 4), dst);
      }
    }

    // Browsers treat delays of 0 or 1 centiseconds as 100 ms.
    yield { data: canvas.slice(), width, height, delay: info.delay <= 1 ? 100 : info.delay * 10 };

    if (info.disposal === 2) {
      // Restore the frame's area to transparent.
      for (let y = clip.y0; y < clip.y1; y++) {
        canvas.fill(0, (y * width + clip.x0) * 4, (y * width + clip.x1) * 4);
      }
    } else if (previous) {
      canvas.set(previous);
    }
  }
}

interface FrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The part of a frame that lies on a width x height screen (may be empty). */
export function clipRect(frame: FrameRect, width: number, height: number): { x0: number; y0: number; x1: number; y1: number } {
  const x0 = Math.min(width, Math.max(0, frame.x));
  const y0 = Math.min(height, Math.max(0, frame.y));
  const x1 = Math.max(x0, Math.min(width, frame.x + frame.width));
  const y1 = Math.max(y0, Math.min(height, frame.y + frame.height));
  return { x0, y0, x1, y1 };
}

/**
 * A copy of the file in which every frame sits at (0, 0) on a maxW x maxH
 * screen, so omggif decodes each frame into the top-left of a buffer with
 * rows maxW pixels apart.
 */
function framesAtOrigin(
  bytes: Uint8Array,
  infos: { has_local_palette: boolean; palette_offset: number | null; data_offset: number }[],
  maxW: number,
  maxH: number,
): Uint8Array {
  const copy = bytes.slice();
  copy[6] = maxW & 0xff;
  copy[7] = maxW >> 8;
  copy[8] = maxH & 0xff;
  copy[9] = maxH >> 8;
  for (const info of infos) {
    // The 10-byte image descriptor comes right before the local palette,
    // or before the image data when there is no local palette.
    const at = (info.has_local_palette ? info.palette_offset! : info.data_offset) - 10;
    if (copy[at] !== 0x2c) throw new Error('Malformed GIF: image descriptor not found.');
    copy.fill(0, at + 1, at + 5);
  }
  return copy;
}
