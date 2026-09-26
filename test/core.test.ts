import { describe, expect, it } from 'vitest';
import {
  RAMPS,
  asciify,
  convert,
  gridSize,
  resolveRamp,
  rgbTo256,
  toAnsi,
  toHtml,
  toText,
  type PixelData,
} from '../src/core/index.js';

/** Build an image from grey levels (0-255), one per pixel, fully opaque. */
function grey(width: number, height: number, values: number[]): PixelData {
  const data = new Uint8Array(width * height * 4);
  values.forEach((v, i) => data.set([v, v, v, 255], i * 4));
  return { data, width, height };
}

/** Build an image from [r, g, b, a] tuples. */
function rgba(width: number, height: number, pixels: number[][]): PixelData {
  const data = new Uint8Array(width * height * 4);
  pixels.forEach((p, i) => data.set(p, i * 4));
  return { data, width, height };
}

describe('gridSize', () => {
  it('halves rows for 2:1 terminal cells', () => {
    expect(gridSize(100, 100, { width: 10 })).toEqual({ columns: 10, rows: 5 });
    expect(gridSize(200, 100, { width: 20 })).toEqual({ columns: 20, rows: 5 });
  });

  it('respects a custom character aspect', () => {
    expect(gridSize(100, 100, { width: 10, charAspect: 1 })).toEqual({ columns: 10, rows: 10 });
  });

  it('derives columns from height alone', () => {
    expect(gridSize(100, 100, { height: 5 })).toEqual({ columns: 10, rows: 5 });
  });

  it('fits inside width and height when both are given', () => {
    expect(gridSize(100, 100, { width: 40, height: 5 })).toEqual({ columns: 10, rows: 5 });
    expect(gridSize(100, 100, { width: 10, height: 50 })).toEqual({ columns: 10, rows: 5 });
  });

  it('defaults to 80 columns and never returns zero rows', () => {
    expect(gridSize(1000, 10)).toEqual({ columns: 80, rows: 1 });
  });

  it('rejects invalid sizes', () => {
    expect(() => gridSize(10, 10, { width: 0 })).toThrow(RangeError);
    expect(() => gridSize(10, 10, { width: 2.5 })).toThrow(RangeError);
    expect(() => gridSize(10, 10, { charAspect: -1 })).toThrow(RangeError);
  });
});

describe('convert', () => {
  it('maps black to the first ramp character and white to the last', () => {
    const art = convert(grey(2, 1, [0, 255]), { width: 2, charAspect: 1, ramp: ' #' });
    expect(art.columns).toBe(2);
    expect(art.rows).toBe(1);
    expect(toText(art)).toBe(' #');
  });

  it('spreads a grey gradient evenly across a custom ramp', () => {
    const art = convert(grey(5, 1, [0, 64, 128, 191, 255]), { width: 5, charAspect: 1, ramp: 'abcde' });
    expect(toText(art)).toBe('abcde');
  });

  it('inverts for light backgrounds', () => {
    const art = convert(grey(5, 1, [0, 64, 128, 191, 255]), {
      width: 5,
      charAspect: 1,
      ramp: 'abcde',
      invert: true,
    });
    expect(toText(art)).toBe('edcba');
  });

  it('produces exact multi-row output', () => {
    // 4x4 image: top-left quadrant white, the rest black.
    const px = [255, 255, 0, 0, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const art = convert(grey(4, 4, px), { width: 4, charAspect: 2, ramp: RAMPS.minimal });
    expect(toText(art)).toBe('##  \n    ');
  });

  it('averages every source pixel under a cell', () => {
    // A 2x2 checkerboard collapses to one mid-grey cell.
    const art = convert(grey(2, 2, [0, 255, 255, 0]), { width: 1, charAspect: 1, ramp: ' .#' });
    expect(toText(art)).toBe('.');
  });

  it('upsamples small images by repeating pixels', () => {
    const art = convert(grey(2, 1, [0, 255]), { width: 4, charAspect: 1, ramp: ' #' });
    expect(toText(art)).toBe('  ##\n  ##');
  });

  it('treats transparent pixels as empty, inverted or not', () => {
    const img = rgba(2, 1, [
      [255, 255, 255, 0],
      [0, 0, 0, 0],
    ]);
    expect(toText(convert(img, { width: 2, charAspect: 1, ramp: ' #' }))).toBe('  ');
    expect(toText(convert(img, { width: 2, charAspect: 1, ramp: ' #', invert: true }))).toBe('  ');
  });

  it('applies brightness, contrast and gamma', () => {
    const mid = grey(1, 1, [128]);
    const opts = { width: 1, charAspect: 1, ramp: 'abcde' } as const;
    expect(toText(convert(mid, opts))).toBe('c');
    expect(toText(convert(mid, { ...opts, brightness: 0.5 }))).toBe('e');
    expect(toText(convert(mid, { ...opts, brightness: -0.5 }))).toBe('a');
    expect(toText(convert(grey(1, 1, [200]), { ...opts, contrast: 0 }))).toBe('c');
    // 64/255 = 0.25 -> "b"; gamma 2 lifts it to 0.5 -> "c".
    const dark = grey(1, 1, [64]);
    expect(toText(convert(dark, opts))).toBe('b');
    expect(toText(convert(dark, { ...opts, gamma: 2 }))).toBe('c');
  });

  it('dithers flat mid-grey into a mix of characters', () => {
    const img = grey(8, 8, new Array(64).fill(128));
    const opts = { width: 8, charAspect: 1, ramp: ' #' } as const;
    const plain = convert(img, opts).chars.filter((c) => c === '#').length;
    const dithered = convert(img, { ...opts, dither: true }).chars.filter((c) => c === '#').length;
    expect(plain).toBe(64);
    expect(dithered).toBeGreaterThanOrEqual(26);
    expect(dithered).toBeLessThanOrEqual(38);
  });

  it('records the average colour of each cell', () => {
    const img = rgba(2, 1, [
      [255, 0, 0, 255],
      [0, 0, 255, 255],
    ]);
    const art = convert(img, { width: 2, charAspect: 1 });
    expect(Array.from(art.colors)).toEqual([255, 0, 0, 0, 0, 255]);
  });

  it('ignores the colour of transparent pixels when averaging', () => {
    const img = rgba(2, 1, [
      [255, 0, 0, 255],
      [0, 255, 0, 0],
    ]);
    const art = convert(img, { width: 1, charAspect: 0.5 });
    expect(Array.from(art.colors)).toEqual([255, 0, 0]);
  });

  it('accepts Uint8ClampedArray and plain arrays', () => {
    const data = [0, 0, 0, 255, 255, 255, 255, 255];
    const opts = { width: 2, charAspect: 1, ramp: ' #' } as const;
    expect(toText(convert({ data, width: 2, height: 1 }, opts))).toBe(' #');
    expect(toText(convert({ data: new Uint8ClampedArray(data), width: 2, height: 1 }, opts))).toBe(' #');
  });

  it('rejects bad input with clear errors', () => {
    expect(() => convert({ data: new Uint8Array(4), width: 2, height: 1 })).toThrow(/too short/);
    expect(() => convert(grey(1, 1, [0]), { ramp: 'x' })).toThrow(/at least 2 characters/);
    expect(() => convert(grey(1, 1, [0]), { gamma: 0 })).toThrow(/gamma/);
    expect(() => convert(grey(1, 1, [0]), { contrast: -1 })).toThrow(/contrast/);
    expect(() => convert(grey(1, 1, [0]), { brightness: Number.NaN })).toThrow(/brightness/);
  });
});

describe('ramps', () => {
  it('resolves presets and custom strings by code point', () => {
    expect(resolveRamp()).toEqual(Array.from(RAMPS.standard));
    expect(resolveRamp('blocks')).toEqual([' ', '░', '▒', '▓', '█']);
    expect(resolveRamp('.🙂')).toEqual(['.', '🙂']);
  });

  it('keeps the original 2022 character set in the detailed preset', () => {
    const original = "$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,\"^`'.";
    expect(RAMPS.detailed).toBe(' ' + Array.from(original).reverse().join(''));
  });
});

describe('renderers', () => {
  const img = rgba(3, 1, [
    [255, 255, 0, 255],
    [255, 255, 0, 255],
    [0, 0, 0, 255],
  ]);
  const art = convert(img, { width: 3, charAspect: 1, ramp: ' #' });

  it('emits truecolor ANSI only when the colour changes, and resets each line', () => {
    expect(toAnsi(art)).toBe('\x1b[38;2;255;255;0m## \x1b[0m');
  });

  it('falls back to the xterm-256 palette', () => {
    expect(toAnsi(art, '256')).toBe('\x1b[38;5;226m## \x1b[0m');
  });

  it('maps colours to the nearest xterm-256 entry', () => {
    expect(rgbTo256(0, 0, 0)).toBe(16);
    expect(rgbTo256(255, 255, 255)).toBe(231);
    expect(rgbTo256(128, 128, 128)).toBe(244);
    expect(rgbTo256(0, 0, 255)).toBe(21);
  });

  it('renders escaped HTML with optional colour spans', () => {
    const lt = convert(grey(2, 1, [0, 255]), { width: 2, charAspect: 1, ramp: '&<' });
    expect(toHtml(lt)).toBe('<pre class="ascii-art">&amp;&lt;</pre>');
    expect(toHtml(art, { color: true })).toBe('<pre class="ascii-art"><span style="color:#ffff00">## </span></pre>');
    const page = toHtml(art, { standalone: true, theme: 'light', title: 'a<b' });
    expect(page).toMatch(/^<!doctype html>/);
    expect(page).toContain('<title>a&lt;b</title>');
    expect(page).toContain('background: #fff');
  });

  it('asciify returns plain or coloured text', () => {
    expect(asciify(img, { width: 3, charAspect: 1, ramp: ' #' })).toBe('## ');
    expect(asciify(img, { width: 3, charAspect: 1, ramp: ' #', color: true })).toBe(toAnsi(art));
    expect(asciify(img, { width: 3, charAspect: 1, ramp: ' #', color: '256' })).toBe(toAnsi(art, '256'));
  });
});
