import { describe, expect, it } from 'vitest';
import { FORMATS, exportLayout, fitFontSize, isExportFormat, parseSize, type ExportLayoutInput } from '../web/layout.js';

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

  it('crops to a square around the centre', () => {
    const out = exportLayout({ ...base, size: { kind: 'width', pixels: 512 }, square: 'crop' });
    expect([out.width, out.height]).toEqual([512, 512]);
    // The 48em wide art is cut to 24em; the grid starts left of the canvas.
    expect(out.fontSize).toBeCloseTo(512 / 24);
    expect(out.offsetX).toBeCloseTo(-12 * (512 / 24));
    expect(out.offsetY).toBeCloseTo(0);
  });

  it('caps the canvas side and reports it', () => {
    const out = exportLayout({ ...base, size: { kind: 'width', pixels: 20000 }, maxSide: 4096 });
    expect(out.width).toBe(4096);
    expect(out.height).toBe(2048);
    expect(out.limited).toBe(true);
  });
});
