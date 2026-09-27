/**
 * Largest image the decoders will open, in pixels (100 megapixels, about
 * 400 MB of RGBA). A few bytes of compressed data can claim a huge size, so
 * the size is checked from the file header before any pixels are allocated.
 */
export const MAX_PIXELS = 100_000_000;

/** Throw if an image of this size is over the pixel limit. */
export function checkPixels(width: number, height: number, maxPixels: number = MAX_PIXELS): void {
  if (width * height > maxPixels) {
    throw new RangeError(
      `Image is ${width}×${height} pixels, over the limit of ${maxPixels.toLocaleString('en')} pixels.`,
    );
  }
}
