import { describe, expect, it } from 'vitest';
import {
  IOS_CANVAS_AREA,
  isAppleMobile,
  usableArea,
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

describe('browser canvas limits', () => {
  // 80 x 40 cells of 0.6em x 1.2em -> 48em x 48em, a square.
  const square: ExportLayoutInput = {
    columns: 80,
    rows: 40,
    cell,
    size: { kind: 'width', pixels: 4096 },
    screenFontSize: 10,
    square: 'none',
    padding: 0,
  };
  const ios = { maxSide: 8192, maxArea: IOS_CANVAS_AREA };

  it('leaves exports that fit alone', () => {
    const out = exportLayout({ ...square, limits: ios });
    expect(out).toMatchObject({ width: 4096, height: 4096, reduced: false, requested: { width: 4096, height: 4096 } });
  });

  it('scales an export over the area limit down, keeping its shape', () => {
    // 12x a 10px preview font: 48em * 120px = 5760 px square, about 33 MP.
    const out = exportLayout({ ...square, size: { kind: 'scale', factor: 12 }, limits: ios });
    expect(out.requested).toEqual({ width: 5760, height: 5760 });
    expect(out.reduced).toBe(true);
    expect(out.width * out.height).toBeLessThanOrEqual(IOS_CANVAS_AREA);
    expect(out.width).toBe(out.height);
    expect(out.width).toBeGreaterThanOrEqual(4095);
  });

  it('keeps the aspect ratio of wide art when reducing', () => {
    // 80 x 20 cells -> 48em x 24em, 2:1.
    const out = exportLayout({ ...square, rows: 20, limits: { maxSide: 8192, maxArea: 2_000_000 } });
    expect(out.requested).toEqual({ width: 4096, height: 2048 });
    expect(out.width * out.height).toBeLessThanOrEqual(2_000_000);
    expect(out.width / out.height).toBeCloseTo(2, 2);
    expect(out.width).toBeGreaterThan(1990);
  });

  it('respects a smaller maximum side', () => {
    const out = exportLayout({ ...square, rows: 20, limits: { maxSide: 2048, maxArea: 1e9 } });
    expect(out).toMatchObject({ width: 2048, height: 1024, reduced: true });
    expect(out.fontSize * 48).toBeLessThanOrEqual(2048);
  });

  it('centres the art in a reduced padded square', () => {
    const out = exportLayout({ ...square, rows: 20, square: 'pad', padding: 1, limits: { maxSide: 8192, maxArea: 1_000_000 } });
    expect(out.width).toBe(out.height);
    expect(out.width).toBeLessThanOrEqual(1000);
    // One font size of padding, give or take the pixel lost to rounding down.
    expect(Math.abs(out.offsetX - out.fontSize)).toBeLessThan(1);
    expect(out.offsetY).toBeCloseTo((out.height - 24 * out.fontSize) / 2);
  });
});

describe('usableArea', () => {
  /** A fake browser that can draw up to `limit` pixels and records what was probed. */
  const browser = (limit: number) => {
    const probed: number[] = [];
    return { probed, probe: (a: number) => (probed.push(a), a <= limit) };
  };

  it('does not probe areas already known to work', () => {
    const b = browser(50e6);
    const known = { ok: 20e6, fail: Infinity };
    expect(usableArea(10e6, known, b.probe)).toBe(10e6);
    expect(b.probed).toEqual([]);
  });

  it('probes the requested area once and remembers it', () => {
    const b = browser(50e6);
    const known = { ok: 0, fail: Infinity };
    expect(usableArea(40e6, known, b.probe)).toBe(40e6);
    expect(usableArea(30e6, known, b.probe)).toBe(30e6);
    expect(b.probed).toEqual([40e6]);
  });

  it('halves until a probe succeeds, and never retries a failed size', () => {
    const b = browser(IOS_CANVAS_AREA);
    const known = { ok: 0, fail: Infinity };
    expect(usableArea(64e6, known, b.probe)).toBe(16e6);
    expect(b.probed).toEqual([64e6, 32e6, 16e6]);
    expect(known).toEqual({ ok: 16e6, fail: 32e6 });
    // Asking for 40 MP again only probes below the known failure, then
    // settles for the largest area that has worked.
    expect(usableArea(40e6, known, b.probe)).toBe(16e6);
    expect(b.probed.at(-1)).toBe(32e6 - 1);
  });

  it('starts below a known ceiling such as the iOS limit', () => {
    const b = browser(1e9);
    const known = { ok: 0, fail: IOS_CANVAS_AREA + 1 };
    expect(usableArea(64e6, known, b.probe)).toBe(IOS_CANVAS_AREA);
    expect(b.probed).toEqual([IOS_CANVAS_AREA]);
  });
});

describe('isAppleMobile', () => {
  it('recognises iPhone, iPad and iPadOS desktop mode', () => {
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
    expect(isAppleMobile({ userAgent: iphone })).toBe(true);
    expect(isAppleMobile({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' })).toBe(true);
    const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
    expect(isAppleMobile({ userAgent: mac, platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true);
    expect(isAppleMobile({ userAgent: mac, platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false);
    expect(isAppleMobile({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0', platform: 'Win32' })).toBe(false);
  });
});
