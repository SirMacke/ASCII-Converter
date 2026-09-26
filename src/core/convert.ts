import { resolveRamp, type RampName } from './ramps.js';

/** Raw pixels: 4 bytes per pixel (RGBA), row-major, no padding. */
export interface PixelData {
  data: ArrayLike<number>;
  width: number;
  height: number;
}

export interface ConvertOptions {
  /** Output width in characters. Defaults to 80 when neither width nor height is set. */
  width?: number;
  /** Output height in rows. With `width` as well, the image is fitted inside both. */
  height?: number;
  /** Height of a character cell divided by its width. Terminals are roughly 2. */
  charAspect?: number;
  /** A preset name or a custom string of characters, lightest first. */
  ramp?: RampName | (string & {});
  /** Map dark pixels to dense characters, for light backgrounds. */
  invert?: boolean;
  /** Added to brightness after contrast, from -1 to 1. Default 0. */
  brightness?: number;
  /** Contrast multiplier around mid-grey. 1 leaves it unchanged. */
  contrast?: number;
  /** Gamma correction. Values above 1 brighten mid-tones. Default 1. */
  gamma?: number;
  /** Floyd-Steinberg error diffusion across ramp levels. */
  dither?: boolean;
}

export interface AsciiArt {
  columns: number;
  rows: number;
  /** One character per cell, row-major, length columns * rows. */
  chars: string[];
  /** Average RGB colour per cell after tone adjustments, length columns * rows * 3. */
  colors: Uint8Array;
}

export interface GridSize {
  columns: number;
  rows: number;
}

const DEFAULT_WIDTH = 80;
const DEFAULT_CHAR_ASPECT = 2;

/**
 * Work out how many columns and rows an image of the given pixel size
 * needs so it keeps its proportions when drawn with cells that are
 * `charAspect` times taller than they are wide.
 */
export function gridSize(
  imageWidth: number,
  imageHeight: number,
  options: Pick<ConvertOptions, 'width' | 'height' | 'charAspect'> = {},
): GridSize {
  const charAspect = options.charAspect ?? DEFAULT_CHAR_ASPECT;
  positive('charAspect', charAspect);
  if (options.width !== undefined) positiveInt('width', options.width);
  if (options.height !== undefined) positiveInt('height', options.height);

  // Rows needed per column of output.
  const ratio = imageHeight / imageWidth / charAspect;
  const { width, height } = options;

  if (width === undefined && height !== undefined) {
    return { columns: Math.max(1, Math.round(height / ratio)), rows: height };
  }
  const columns = width ?? DEFAULT_WIDTH;
  const rows = Math.max(1, Math.round(columns * ratio));
  if (height !== undefined && rows > height) {
    return { columns: Math.max(1, Math.min(columns, Math.round(height / ratio))), rows: height };
  }
  return { columns, rows };
}

/**
 * Convert RGBA pixels into a grid of characters and colours.
 * Pure function: no I/O, works in Node and browsers.
 */
export function convert(image: PixelData, options: ConvertOptions = {}): AsciiArt {
  const { data, width: w, height: h } = image;
  positiveInt('image width', w);
  positiveInt('image height', h);
  if (data.length < w * h * 4) {
    throw new RangeError(`Pixel data too short: expected ${w * h * 4} bytes for ${w}x${h} RGBA, got ${data.length}`);
  }

  const ramp = resolveRamp(options.ramp);
  const levels = ramp.length - 1;
  const brightness = options.brightness ?? 0;
  const contrast = options.contrast ?? 1;
  const gamma = options.gamma ?? 1;
  finite('brightness', brightness);
  finite('contrast', contrast);
  if (contrast < 0) throw new RangeError(`contrast must be >= 0, got ${contrast}`);
  positive('gamma', gamma);

  const tone = (v: number): number => {
    let x = (v - 0.5) * contrast + 0.5 + brightness;
    x = x < 0 ? 0 : x > 1 ? 1 : x;
    return gamma === 1 ? x : x ** (1 / gamma);
  };

  const { columns, rows } = gridSize(w, h, options);
  const cells = columns * rows;
  const ink = new Float64Array(cells);
  const colors = new Uint8Array(cells * 3);

  for (let row = 0; row < rows; row++) {
    const y0 = Math.floor((row * h) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((row + 1) * h) / rows));
    for (let col = 0; col < columns; col++) {
      const x0 = Math.floor((col * w) / columns);
      const x1 = Math.max(x0 + 1, Math.floor(((col + 1) * w) / columns));

      // Box filter: average every source pixel under the cell, weighting
      // colour by alpha so transparent pixels don't darken edges.
      let sumA = 0;
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      for (let y = y0; y < y1; y++) {
        let i = (y * w + x0) * 4;
        for (let x = x0; x < x1; x++, i += 4) {
          const a = data[i + 3]!;
          sumA += a;
          sumR += data[i]! * a;
          sumG += data[i + 1]! * a;
          sumB += data[i + 2]! * a;
        }
      }

      const cell = row * columns + col;
      const count = (x1 - x0) * (y1 - y0);
      const coverage = sumA / (count * 255);
      let r = 0;
      let g = 0;
      let b = 0;
      if (sumA > 0) {
        r = tone(sumR / sumA / 255);
        g = tone(sumG / sumA / 255);
        b = tone(sumB / sumA / 255);
      }
      colors[cell * 3] = Math.round(r * 255);
      colors[cell * 3 + 1] = Math.round(g * 255);
      colors[cell * 3 + 2] = Math.round(b * 255);

      // Rec. 709 luma of the adjusted colour.
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      ink[cell] = (options.invert ? 1 - luma : luma) * coverage;
    }
  }

  const chars = new Array<string>(cells);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const cell = row * columns + col;
      const value = ink[cell]!;
      const level = Math.min(levels, Math.max(0, Math.round(value * levels)));
      chars[cell] = ramp[level]!;

      if (options.dither) {
        const err = value - level / levels;
        if (col + 1 < columns) ink[cell + 1]! += (err * 7) / 16;
        if (row + 1 < rows) {
          const below = cell + columns;
          if (col > 0) ink[below - 1]! += (err * 3) / 16;
          ink[below]! += (err * 5) / 16;
          if (col + 1 < columns) ink[below + 1]! += err / 16;
        }
      }
    }
  }

  return { columns, rows, chars, colors };
}

function finite(name: string, value: number): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number, got ${String(value)}`);
  }
}

function positive(name: string, value: number): void {
  finite(name, value);
  if (value <= 0) throw new RangeError(`${name} must be greater than 0, got ${value}`);
}

function positiveInt(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer, got ${String(value)}`);
  }
}
