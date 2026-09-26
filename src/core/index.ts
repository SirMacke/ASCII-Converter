import { convert, type ConvertOptions, type PixelData } from './convert.js';
import { toAnsi, toText, type ColorDepth } from './render.js';

export { convert, gridSize } from './convert.js';
export type { AsciiArt, ConvertOptions, GridSize, PixelData } from './convert.js';
export { RAMPS, isRampName, resolveRamp } from './ramps.js';
export type { RampName } from './ramps.js';
export { rgbTo256, toAnsi, toHtml, toText } from './render.js';
export type { ColorDepth, HtmlOptions } from './render.js';

export interface AsciifyOptions extends ConvertOptions {
  /** Colour the output with ANSI escape codes. Default false (plain text). */
  color?: boolean | ColorDepth;
}

/**
 * Convert RGBA pixels straight to a string: plain text, or ANSI-coloured
 * text when `color` is set (`true` means truecolor).
 */
export function asciify(image: PixelData, options: AsciifyOptions = {}): string {
  const art = convert(image, options);
  if (!options.color) return toText(art);
  return toAnsi(art, options.color === true ? 'truecolor' : options.color);
}
