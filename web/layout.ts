// Pure sizing and format logic for the web page. No DOM access here so it
// can be unit tested in Node.

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
  /** Largest allowed canvas side. Browsers refuse very large canvases. */
  maxSide?: number;
}

export interface ExportLayout {
  width: number;
  height: number;
  fontSize: number;
  /** Where the top-left of the grid goes. Negative when cropping. */
  offsetX: number;
  offsetY: number;
  /** True when the requested size had to be reduced to stay under maxSide. */
  limited: boolean;
}

/** Work out canvas size, font size and grid offset for an exported image. */
export function exportLayout(input: ExportLayoutInput): ExportLayout {
  const artW = input.columns * input.cell.width;
  const artH = input.rows * input.cell.height;
  const pad = 2 * input.padding;

  let boxW = artW + pad;
  let boxH = artH + pad;
  if (input.square === 'pad') boxW = boxH = Math.max(artW, artH) + pad;
  if (input.square === 'crop') boxW = boxH = Math.min(artW, artH) + pad;

  let fontSize = input.size.kind === 'scale' ? input.screenFontSize * input.size.factor : input.size.pixels / boxW;
  const maxSide = input.maxSide ?? 8192;
  const limit = maxSide / Math.max(boxW, boxH);
  const limited = fontSize > limit;
  if (limited) fontSize = limit;

  const width = Math.max(1, Math.round(boxW * fontSize));
  const height = Math.max(1, Math.round(boxH * fontSize));
  return {
    width,
    height,
    fontSize,
    offsetX: (width - artW * fontSize) / 2,
    offsetY: (height - artH * fontSize) / 2,
    limited,
  };
}
