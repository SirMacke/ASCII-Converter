/**
 * Built-in character ramps, ordered from "no ink" (index 0) to "most ink".
 *
 * On a dark terminal, brighter pixels map to denser characters. Pass
 * `invert: true` to flip that for light backgrounds.
 */
export const RAMPS = {
  /** Ten characters, readable at most sizes. */
  standard: ' .:-=+*#%@',
  /** The 70-character ramp from the original 2022 script, lightest first. */
  detailed: " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  /** Unicode shade blocks. Needs a font with box-drawing glyphs. */
  blocks: ' ░▒▓█',
  /** Four characters for a high-contrast, poster-like look. */
  minimal: ' .:#',
} as const;

export type RampName = keyof typeof RAMPS;

export function isRampName(value: string): value is RampName {
  return Object.prototype.hasOwnProperty.call(RAMPS, value);
}

/**
 * Resolve a preset name or a custom character string to an array of
 * characters (split by code point, so non-ASCII ramps work).
 */
export function resolveRamp(ramp: string = 'standard'): string[] {
  const chars = Array.from(isRampName(ramp) ? RAMPS[ramp] : ramp);
  if (chars.length < 2) {
    throw new RangeError(
      `Ramp must be a preset (${Object.keys(RAMPS).join(', ')}) or at least 2 characters, got ${JSON.stringify(ramp)}`,
    );
  }
  return chars;
}
