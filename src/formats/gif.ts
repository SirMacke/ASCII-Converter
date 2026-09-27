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

  const canvas = new Uint8Array(width * height * 4);
  for (let i = 0; i < count; i++) {
    const info = reader.frameInfo(i);
    // Each frame is decoded into a buffer of its own size first.
    checkPixels(info.width, info.height, maxPixels);
    const previous = info.disposal === 3 ? canvas.slice() : undefined;
    reader.decodeAndBlitFrameRGBA(i, canvas);
    // Browsers treat delays of 0 or 1 centiseconds as 100 ms.
    yield { data: canvas.slice(), width, height, delay: info.delay <= 1 ? 100 : info.delay * 10 };

    if (info.disposal === 2) {
      // Restore the frame's area to transparent.
      for (let y = info.y; y < Math.min(height, info.y + info.height); y++) {
        const start = (y * width + info.x) * 4;
        canvas.fill(0, start, start + Math.min(info.width, width - info.x) * 4);
      }
    } else if (previous) {
      canvas.set(previous);
    }
  }
}
