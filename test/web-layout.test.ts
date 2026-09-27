import { describe, expect, it } from 'vitest';
import {
  FORMATS,
  MAX_CANVAS_AREA,
  MAX_CANVAS_SIDE,
  capFontSize,
  exportLayout,
  fitFontSize,
  isExportFormat,
  parseSize,
  sliceArt,
  squareCrop,
  type ExportLayoutInput,
} from '../web/layout.js';

// A typical monospace cell: 0.6em wide, 1.2em tall.
const cell = { width: 0.6, height: 1.2 };

describe('fitFontSize', () => {
  it('is limited by width for wide art', () => {
    // 100 columns * 0.6 = 60em wide, 50 rows * 1.2 = 60em tall.
    expect(fitFontSize(100, 50, cell, { width: 600, height: 1200 })).toBe(10);
  });

  it('is limited by height for tall art', () => {
    expect(fitFontSize(100, 50, cell, { width: 1200, height: 600 })).toBe(10);
  });

  it('ignores height when none is given', () => {
    expect(fitFontSize(100, 500, cell, { width: 600 })).toBe(10);
  });

  it('rounds down so the grid never overflows', () => {
    const size = fitFontSize(97, 41, cell, { width: 1000, height: 700 });
    expect(97 * cell.width * size).toBeLessThanOrEqual(1000);
    expect(41 * cell.height * size).toBeLessThanOrEqual(700);
    expect(size).toBe(14.22);
  });

  it('clamps to the limits', () => {
    expect(fitFontSize(2, 1, cell, { width: 5000, height: 5000 })).toBe(32);
    expect(fitFontSize(2, 1, cell, { width: 5000, height: 5000 }, { max: 100 })).toBe(100);
    expect(fitFontSize(1000, 1000, cell, { width: 100, height: 100 })).toBe(1);
    expect(fitFontSize(1000, 1000, cell, { width: 100, height: 100 }, { min: 0.01 })).toBe(0.08);
  });
});

describe('parseSize', () => {
  it('reads scale factors and pixel widths', () => {
    expect(parseSize('x1')).toEqual({ kind: 'scale', factor: 1 });
    expect(parseSize('x2.5')).toEqual({ kind: 'scale', factor: 2.5 });
    expect(parseSize('1024')).toEqual({ kind: 'width', pixels: 1024 });
  });

  it('rejects anything else', () => {
    expect(() => parseSize('big')).toThrow(RangeError);
    expect(() => parseSize('0')).toThrow(RangeError);
    expect(() => parseSize('10.5')).toThrow(RangeError);
  });
});

describe('formats', () => {
  it('knows which formats are lossy and can be transparent', () => {
    expect(FORMATS.png).toMatchObject({ mime: 'image/png', ext: 'png', lossy: false, alpha: true });
    expect(FORMATS.jpeg).toMatchObject({ mime: 'image/jpeg', ext: 'jpg', lossy: true, alpha: false });
    expect(FORMATS.webp).toMatchObject({ mime: 'image/webp', ext: 'webp', lossy: true, alpha: true });
    expect(isExportFormat('webp')).toBe(true);
    expect(isExportFormat('gif')).toBe(false);
    expect(isExportFormat('toString')).toBe(false);
  });
});

describe('exportLayout', () => {
  // 100 x 50 cells -> 60em x 60em art. 80 x 20 cells -> 48em x 24em.
  const base: ExportLayoutInput = {
    columns: 80,
    rows: 20,
    cell,
    size: { kind: 'width', pixels: 1000 },
    screenFontSize: 10,
    square: 'none',
    padding: 0,
  };

  it('hits an exact pixel width and keeps the aspect ratio', () => {
    const out = exportLayout(base);
    expect(out.width).toBe(1000);
    expect(out.height).toBe(500);
    expect(out.fontSize).toBeCloseTo(1000 / 48);
    expect(out.offsetX).toBeCloseTo(0);
    expect(out.offsetY).toBeCloseTo(0);
    expect(out.limited).toBe(false);
  });

  it('includes padding in the requested width', () => {
    const out = exportLayout({ ...base, padding: 1 });
    // 48em + 2em padding = 50em -> 20px per em.
    expect(out).toMatchObject({ width: 1000, height: 520, fontSize: 20, offsetX: 20, offsetY: 20 });
  });

  it('scales from the on-screen font size', () => {
    const out = exportLayout({ ...base, size: { kind: 'scale', factor: 2 } });
    expect(out).toMatchObject({ width: 960, height: 480, fontSize: 20 });
  });

  it('pads to a square, centring the art', () => {
    const out = exportLayout({ ...base, size: { kind: 'width', pixels: 512 }, square: 'pad' });
    expect([out.width, out.height]).toEqual([512, 512]);
    expect(out.offsetX).toBeCloseTo(0);
    expect(out.offsetY).toBeCloseTo((512 - 24 * (512 / 48)) / 2);
  });

  it('crops to a square of whole cells around the centre', () => {
    const out = exportLayout({ ...base, size: { kind: 'width', pixels: 512 }, square: 'crop', padding: 1 });
    expect([out.width, out.height]).toEqual([512, 512]);
    // The 48em wide art is cut to its middle 40 columns (24em), plus 1em padding each side.
    expect(out.region).toEqual({ col0: 20, row0: 0, columns: 40, rows: 20 });
    expect(out.fontSize).toBeCloseTo(512 / 26);
    // Same margin on every side.
    expect(out.offsetX).toBeCloseTo(512 / 26);
    expect(out.offsetY).toBeCloseTo(512 / 26);
  });

  it('draws every cell unless cropping', () => {
    expect(exportLayout(base).region).toEqual({ col0: 0, row0: 0, columns: 80, rows: 20 });
    expect(exportLayout({ ...base, square: 'pad' }).region).toEqual({ col0: 0, row0: 0, columns: 80, rows: 20 });
  });

  it('caps the canvas side and reports it', () => {
    const out = exportLayout({ ...base, size: { kind: 'width', pixels: 20000 }, maxSide: 4096 });
    expect(out.width).toBe(4096);
    expect(out.height).toBe(2048);
    expect(out.limited).toBe(true);
  });
});

describe('squareCrop and sliceArt', () => {
  it('keeps the middle whole cells of wide and tall grids', () => {
    // 100 x 10 cells = 60em x 12em: keep 20 columns (12em).
    expect(squareCrop(100, 10, cell)).toEqual({ col0: 40, row0: 0, columns: 20, rows: 10 });
    // 10 x 100 cells = 6em x 120em: keep 5 rows (6em).
    expect(squareCrop(10, 100, cell)).toEqual({ col0: 0, row0: 47, columns: 10, rows: 5 });
    expect(squareCrop(1, 1, cell)).toEqual({ col0: 0, row0: 0, columns: 1, rows: 1 });
  });

  it('copies characters and colours of the region', () => {
    const art = {
      columns: 3,
      rows: 2,
      chars: ['a', 'b', 'c', 'd', 'e', 'f'],
      colors: Uint8Array.from({ length: 18 }, (_, i) => i),
    };
    const out = sliceArt(art, { col0: 1, row0: 0, columns: 2, rows: 2 });
    expect(out.chars).toEqual(['b', 'c', 'e', 'f']);
    expect(Array.from(out.colors)).toEqual([3, 4, 5, 6, 7, 8, 12, 13, 14, 15, 16, 17]);
    expect(sliceArt(art, { col0: 0, row0: 0, columns: 3, rows: 2 })).toBe(art);
  });
});

describe('capFontSize', () => {
  it('leaves sizes that fit alone', () => {
    expect(capFontSize(10, 100, 50, cell, 2)).toBe(10);
  });

  it('shrinks the font so the canvas stays under the browser limits', () => {
    // 10 columns x 400 rows at 24px and 3x: 432 x 34560 device pixels.
    const size = capFontSize(24, 10, 400, cell, 3);
    const w = 10 * cell.width * size * 3;
    const h = 400 * cell.height * size * 3;
    expect(h).toBeLessThanOrEqual(MAX_CANVAS_SIDE);
    expect(w * h).toBeLessThanOrEqual(MAX_CANVAS_AREA);
    expect(size).toBeGreaterThan(10);
  });
});
