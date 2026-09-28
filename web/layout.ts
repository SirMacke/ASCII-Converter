// Pure sizing and format logic for the web page. No DOM access here so it
// can be unit tested in Node.

import type { AsciiArt } from '../src/core/index.js';

/** Size of one character cell per 1px of font size (so in em units). */
export interface CellMetrics {
  width: number;
  height: number;
  /** Distance from the top of the cell to the text baseline. */
  ascent: number;
}

export interface Box {
  width: number;
  /** Omit to fit the width only (narrow screens scroll vertically). */
  height?: number;
}

/**
 * The largest font size (in px, rounded down to 1/100) at which a grid of
 * columns x rows cells fits inside the box, clamped to [min, max].
 */
export function fitFontSize(
  columns: number,
  rows: number,
  cell: Pick<CellMetrics, 'width' | 'height'>,
  box: Box,
  limits: { min?: number; max?: number } = {},
): number {
  let size = box.width / (columns * cell.width);
  if (box.height !== undefined) size = Math.min(size, box.height / (rows * cell.height));
  size = Math.floor(size * 100) / 100;
  return Math.min(limits.max ?? 32, Math.max(limits.min ?? 1, size));
}

export type ExportFormat = 'png' | 'jpeg' | 'webp';

export interface FormatInfo {
  mime: string;
  ext: string;
  /** Has a quality setting. */
  lossy: boolean;
  /** Can keep a transparent background. */
  alpha: boolean;
}

export const FORMATS: Record<ExportFormat, FormatInfo> = {
  png: { mime: 'image/png', ext: 'png', lossy: false, alpha: true },
  jpeg: { mime: 'image/jpeg', ext: 'jpg', lossy: true, alpha: false },
  webp: { mime: 'image/webp', ext: 'webp', lossy: true, alpha: true },
};

export function isExportFormat(value: string): value is ExportFormat {
  return Object.prototype.hasOwnProperty.call(FORMATS, value);
}

/** Either a multiple of the on-screen size or an exact output width in pixels. */
export type SizeChoice = { kind: 'scale'; factor: number } | { kind: 'width'; pixels: number };

/** Parse a size option value: "x2" means twice the on-screen size, "1024" means 1024 px wide. */
export function parseSize(value: string): SizeChoice {
  const scale = /^x(\d+(?:\.\d+)?)$/.exec(value);
  if (scale) return { kind: 'scale', factor: Number(scale[1]) };
  const pixels = Number(value);
  if (Number.isInteger(pixels) && pixels > 0) return { kind: 'width', pixels };
  throw new RangeError(`Unknown export size "${value}"`);
}

/**
 * Largest canvas the preview may use, in device pixels. iOS Safari refuses
 * canvases over 16.7 million pixels and Chrome over 32767 px on a side; a
 * refused canvas shows nothing (or crashes the tab).
 */
export const MAX_CANVAS_AREA = 16_777_216;
export const MAX_CANVAS_SIDE = 16_384;

/**
 * Shrink a font size, if needed, so a grid drawn at it fits a canvas the
 * browser will accept at the given device pixel ratio.
 */
export function capFontSize(
  fontSize: number,
  columns: number,
  rows: number,
  cell: Pick<CellMetrics, 'width' | 'height'>,
  dpr: number,
): number {
  const w = columns * cell.width * fontSize * dpr;
  const h = rows * cell.height * fontSize * dpr;
  const factor = Math.min(1, MAX_CANVAS_SIDE / w, MAX_CANVAS_SIDE / h, Math.sqrt(MAX_CANVAS_AREA / (w * h)));
  return factor < 1 ? Math.floor(fontSize * factor * 100) / 100 : fontSize;
}

/** A block of cells: columns col0 .. col0 + columns - 1, rows likewise. */
export interface CellRegion {
  col0: number;
  row0: number;
  columns: number;
  rows: number;
}

/**
 * The centred block of whole cells that comes closest to a square, for
 * cropped exports. Cropping whole cells keeps glyphs from being cut in half
 * at the edges.
 */
export function squareCrop(columns: number, rows: number, cell: Pick<CellMetrics, 'width' | 'height'>): CellRegion {
  const artW = columns * cell.width;
  const artH = rows * cell.height;
  if (artW > artH) {
    const keep = Math.max(1, Math.min(columns, Math.round(artH / cell.width)));
    return { col0: Math.floor((columns - keep) / 2), row0: 0, columns: keep, rows };
  }
  const keep = Math.max(1, Math.min(rows, Math.round(artW / cell.height)));
  return { col0: 0, row0: Math.floor((rows - keep) / 2), columns, rows: keep };
}

/** Copy a block of cells out of converted art. */
export function sliceArt(art: AsciiArt, region: CellRegion): AsciiArt {
  if (region.col0 === 0 && region.row0 === 0 && region.columns === art.columns && region.rows === art.rows) return art;
  const chars: string[] = [];
  const colors = new Uint8Array(region.columns * region.rows * 3);
  for (let r = 0; r < region.rows; r++) {
    const from = (region.row0 + r) * art.columns + region.col0;
    chars.push(...art.chars.slice(from, from + region.columns));
    colors.set(art.colors.subarray(from * 3, (from + region.columns) * 3), r * region.columns * 3);
  }
  return { columns: region.columns, rows: region.rows, chars, colors };
}

/** The largest canvas a browser will actually draw into. */
export interface CanvasLimits {
  /** Longest side in pixels. */
  maxSide: number;
  /** Total pixels. */
  maxArea: number;
}

/**
 * iOS and iPadOS Safari refuse canvases over 16,777,216 pixels (4096 x 4096):
 * drawing silently does nothing and toBlob returns null.
 */
export const IOS_CANVAS_AREA = 16_777_216;

/** iPhone, iPad or iPod; iPadOS reports itself as a Mac with a touch screen. */
export function isAppleMobile(nav: { userAgent: string; platform?: string; maxTouchPoints?: number }): boolean {
  return /\biP(hone|ad|od)\b/.test(nav.userAgent) || (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1);
}

/** What has been learned about canvas areas so far: `ok` works, `fail` and above don't. */
export interface AreaKnowledge {
  ok: number;
  fail: number;
}

/**
 * The largest canvas area known to work that is at most `requested`,
 * probing only what isn't known yet. Tries the requested area, then halves
 * it until a probe succeeds. Updates `known` so each area is probed once.
 */
export function usableArea(requested: number, known: AreaKnowledge, probe: (area: number) => boolean, smallest = 1_000_000): number {
  if (requested <= known.ok) return requested;
  let candidate = Math.min(requested, known.fail - 1);
  while (candidate > known.ok) {
    if (probe(candidate)) {
      known.ok = candidate;
      break;
    }
    known.fail = candidate;
    if (candidate <= smallest) break;
    candidate = Math.max(smallest, Math.floor(candidate / 2));
  }
  return Math.max(1, Math.min(requested, known.ok));
}

/** none keeps the art's shape; pad and crop make a square (for avatars). */
export type SquareMode = 'none' | 'pad' | 'crop';

export interface ExportLayoutInput {
  columns: number;
  rows: number;
  cell: Pick<CellMetrics, 'width' | 'height'>;
  size: SizeChoice;
  /** Font size of the on-screen preview, for scale sizes. */
  screenFontSize: number;
  square: SquareMode;
  /** Margin around the art, in multiples of the font size. */
  padding: number;
  /** Largest canvas side the page offers, whatever the browser. Default 8192. */
  maxSide?: number;
  /** What this browser can draw into; the image shrinks to fit, keeping its shape. */
  limits?: CanvasLimits;
}

export interface ExportLayout {
  width: number;
  height: number;
  fontSize: number;
  /** Where the top-left of the drawn cells goes. */
  offsetX: number;
  offsetY: number;
  /** The cells to draw: all of them, or the square block for crop. */
  region: CellRegion;
  /** True when the requested size had to be reduced to stay under maxSide. */
  limited: boolean;
  /** The size that was asked for (after maxSide), before fitting the browser's limits. */
  requested: { width: number; height: number };
  /** True when the image was scaled down to fit the browser's canvas limits. */
  reduced: boolean;
}

/** Work out canvas size, font size and grid offset for an exported image. */
export function exportLayout(input: ExportLayoutInput): ExportLayout {
  const region =
    input.square === 'crop'
      ? squareCrop(input.columns, input.rows, input.cell)
      : { col0: 0, row0: 0, columns: input.columns, rows: input.rows };
  const artW = region.columns * input.cell.width;
  const artH = region.rows * input.cell.height;
  const pad = 2 * input.padding;

  let boxW = artW + pad;
  let boxH = artH + pad;
  // Cropping to whole cells leaves the block within one cell of square;
  // centring it in a square box evens out the rest.
  if (input.square !== 'none') boxW = boxH = Math.max(artW, artH) + pad;

  let fontSize = input.size.kind === 'scale' ? input.screenFontSize * input.size.factor : input.size.pixels / boxW;
  const maxSide = input.maxSide ?? 8192;
  const limit = maxSide / Math.max(boxW, boxH);
  const limited = fontSize > limit;
  if (limited) fontSize = limit;

  let width = Math.max(1, Math.round(boxW * fontSize));
  let height = Math.max(1, Math.round(boxH * fontSize));
  const requested = { width, height };

  let reduced = false;
  const { limits } = input;
  if (limits && (width > limits.maxSide || height > limits.maxSide || width * height > limits.maxArea)) {
    const factor = Math.min(limits.maxSide / width, limits.maxSide / height, Math.sqrt(limits.maxArea / (width * height)));
    fontSize *= factor;
    // Round down (allowing for float error), then make sure rounding didn't
    // leave the canvas a pixel over.
    const over = (): boolean => width > limits.maxSide || height > limits.maxSide || width * height > limits.maxArea;
    do {
      width = Math.max(1, Math.floor(boxW * fontSize + 1e-6));
      height = Math.max(1, Math.floor(boxH * fontSize + 1e-6));
      if (over()) fontSize *= 0.999;
    } while (over());
    reduced = true;
  }

  return {
    width,
    height,
    fontSize,
    offsetX: (width - artW * fontSize) / 2,
    offsetY: (height - artH * fontSize) / 2,
    region,
    limited,
    requested,
    reduced,
  };
}
