import { readFile } from 'node:fs/promises';
import jpeg from 'jpeg-js';
import pngjs from 'pngjs';
import type { PixelData } from '../core/convert.js';
import { decodeGifFrames } from '../formats/gif.js';

export interface DecodedImage extends PixelData {
  data: Uint8Array;
}

export interface DecodedFrame extends DecodedImage {
  /** How long to show this frame, in milliseconds. 0 for still images. */
  delay: number;
}

export type ImageFormat = 'jpeg' | 'png' | 'gif';

/** Identify an image by its first bytes rather than trusting the file extension. */
export function detectFormat(bytes: Uint8Array): ImageFormat | 'webp' | 'bmp' | 'tiff' | undefined {
  const starts = (...sig: number[]): boolean => sig.every((b, i) => bytes[i] === b);
  if (starts(0xff, 0xd8, 0xff)) return 'jpeg';
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png';
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'gif';
  if (starts(0x52, 0x49, 0x46, 0x46) && ascii(bytes, 8, 4) === 'WEBP') return 'webp';
  if (starts(0x42, 0x4d)) return 'bmp';
  if (starts(0x49, 0x49, 0x2a, 0x00) || starts(0x4d, 0x4d, 0x00, 0x2a)) return 'tiff';
  return undefined;
}

/** Decode a JPEG, PNG or GIF (first frame) into RGBA pixels. */
export function decodeImage(bytes: Uint8Array): DecodedImage {
  const [first] = decodeFrames(bytes, { firstOnly: true });
  return { data: first!.data, width: first!.width, height: first!.height };
}

/**
 * Decode every frame of an animated GIF, composited the way a browser
 * would show them. JPEG and PNG return a single frame with delay 0.
 */
export function decodeFrames(bytes: Uint8Array, options: { firstOnly?: boolean } = {}): DecodedFrame[] {
  const format = detectFormat(bytes);
  switch (format) {
    case 'jpeg':
      return [{ ...decodeJpeg(bytes), delay: 0 }];
    case 'png': {
      const png = pngjs.PNG.sync.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
      return [{ data: new Uint8Array(png.data), width: png.width, height: png.height, delay: 0 }];
    }
    case 'gif':
      return decodeGifFrames(bytes, options);
    case undefined:
      throw new Error('Unrecognised image format. Supported formats: JPEG, PNG, GIF.');
    default:
      throw new Error(`${format.toUpperCase()} images are not supported. Convert to PNG or JPEG first.`);
  }
}

/** Read and decode an image file. */
export async function readImage(path: string): Promise<DecodedImage> {
  return decodeImage(await readFile(path));
}

function decodeJpeg(bytes: Uint8Array): DecodedImage {
  const { data, width, height } = jpeg.decode(bytes, {
    useTArray: true,
    formatAsRGBA: true,
    maxResolutionInMP: 250,
    maxMemoryUsageInMB: 2048,
  });
  return orient({ data, width, height }, jpegOrientation(bytes));
}


/** Read the EXIF orientation tag (1-8) from a JPEG, or 1 if there is none. */
export function jpegOrientation(bytes: Uint8Array): number {
  let i = 2;
  while (i + 4 <= bytes.length && bytes[i] === 0xff) {
    const marker = bytes[i + 1]!;
    if (marker === 0xda || marker === 0xd9) break; // Start of scan / end of image
    const length = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    if (marker === 0xe1 && ascii(bytes, i + 4, 6) === 'Exif\0\0') {
      const tiff = i + 10;
      const little = bytes[tiff] === 0x49;
      const u16 = (o: number): number => (little ? bytes[o]! | (bytes[o + 1]! << 8) : (bytes[o]! << 8) | bytes[o + 1]!);
      const u32 = (o: number): number => (little ? u16(o) + u16(o + 2) * 65536 : u16(o) * 65536 + u16(o + 2));
      const ifd = tiff + u32(tiff + 4);
      if (ifd + 2 > bytes.length) break;
      const entries = u16(ifd);
      for (let e = 0; e < entries; e++) {
        const entry = ifd + 2 + e * 12;
        if (entry + 12 > bytes.length) break;
        if (u16(entry) === 0x0112) {
          const value = u16(entry + 8);
          return value >= 1 && value <= 8 ? value : 1;
        }
      }
      break;
    }
    i += 2 + length;
  }
  return 1;
}

/** Rotate or flip pixels so an EXIF-oriented image displays upright. */
export function orient(image: DecodedImage, orientation: number): DecodedImage {
  if (orientation <= 1 || orientation > 8) return image;
  const { data, width: w, height: h } = image;
  const swap = orientation >= 5;
  const outW = swap ? h : w;
  const outH = swap ? w : h;
  const out = new Uint8Array(outW * outH * 4);

  for (let sy = 0; sy < h; sy++) {
    for (let sx = 0; sx < w; sx++) {
      let dx: number;
      let dy: number;
      switch (orientation) {
        case 2: dx = w - 1 - sx; dy = sy; break; // mirror horizontal
        case 3: dx = w - 1 - sx; dy = h - 1 - sy; break; // rotate 180
        case 4: dx = sx; dy = h - 1 - sy; break; // mirror vertical
        case 5: dx = sy; dy = sx; break; // transpose
        case 6: dx = h - 1 - sy; dy = sx; break; // rotate 90 clockwise
        case 7: dx = h - 1 - sy; dy = w - 1 - sx; break; // transverse
        default: dx = sy; dy = w - 1 - sx; break; // 8: rotate 90 counter-clockwise
      }
      const src = (sy * w + sx) * 4;
      out.set(data.subarray(src, src + 4), (dy * outW + dx) * 4);
    }
  }
  return { data: out, width: outW, height: outH };
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}
