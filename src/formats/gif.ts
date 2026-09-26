import { GifReader } from 'omggif';

/** One composited GIF frame: RGBA pixels plus how long to show it. */
export interface GifFrame {
  data: Uint8Array;
  width: number;
  height: number;
  /** Milliseconds. */
  delay: number;
}

/**
 * Decode the frames of a (possibly animated) GIF, composited the way a
 * browser shows them. Browser-safe: no Node APIs.
 */
export function decodeGifFrames(bytes: Uint8Array, options: { firstOnly?: boolean } = {}): GifFrame[] {
  const reader = new GifReader(bytes);
  const { width, height } = reader;
  const canvas = new Uint8Array(width * height * 4);
  const count = options.firstOnly ? Math.min(1, reader.numFrames()) : reader.numFrames();
  if (count === 0) throw new Error('GIF contains no frames.');

  const frames: GifFrame[] = [];
  for (let i = 0; i < count; i++) {
    const info = reader.frameInfo(i);
    const previous = info.disposal === 3 ? canvas.slice() : undefined;
    reader.decodeAndBlitFrameRGBA(i, canvas);
    // Browsers treat delays of 0 or 1 centiseconds as 100 ms.
    frames.push({ data: canvas.slice(), width, height, delay: info.delay <= 1 ? 100 : info.delay * 10 });

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
  return frames;
}
