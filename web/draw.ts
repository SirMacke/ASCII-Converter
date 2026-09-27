import type { AsciiArt } from '../src/core/index.js';
import type { CellMetrics } from './layout.js';

export interface DrawStyle {
  fontFamily: string;
  fontSize: number;
  cell: CellMetrics;
  foreground: string;
  /** null leaves the canvas transparent. */
  background: string | null;
  /** Use each cell's own colour instead of the foreground. */
  color: boolean;
}

/**
 * Shade characters are drawn as filled cells rather than glyphs, so they
 * tile without gaps whatever the font. Values are coverage from 0 to 1.
 */
const SHADES: Record<string, number> = { '░': 0.25, '▒': 0.5, '▓': 0.75, '█': 1 };

/** Measure a monospace font's cell from the font itself (per 1px of font size). */
export function measureCell(fontFamily: string): CellMetrics {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');
  ctx.font = `100px ${fontFamily}`;
  const m = ctx.measureText('M');
  // fontBoundingBox* is the line box the font asks for: ascent + descent.
  const ascent = (m.fontBoundingBoxAscent || m.actualBoundingBoxAscent * 1.2) / 100;
  const descent = (m.fontBoundingBoxDescent || m.actualBoundingBoxAscent * 0.3) / 100;
  return { width: m.width / 100, height: ascent + descent, ascent };
}

/**
 * Draw the character grid onto a 2D context with its top-left corner at
 * (offsetX, offsetY). The background fills the whole canvas.
 */
export function drawArt(
  ctx: CanvasRenderingContext2D,
  art: AsciiArt,
  style: DrawStyle,
  offsetX = 0,
  offsetY = 0,
): void {
  const { width, height } = ctx.canvas;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (style.background) {
    ctx.fillStyle = style.background;
    ctx.fillRect(0, 0, width, height);
  } else {
    ctx.clearRect(0, 0, width, height);
  }
  ctx.restore();

  const cw = style.cell.width * style.fontSize;
  const ch = style.cell.height * style.fontSize;
  const baseline = style.cell.ascent * style.fontSize;
  ctx.font = `${style.fontSize}px ${style.fontFamily}`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  let fill = '';
  for (let row = 0; row < art.rows; row++) {
    const y = offsetY + row * ch;
    const y0 = Math.round(y);
    const y1 = Math.round(y + ch);
    for (let col = 0; col < art.columns; col++) {
      const cellIndex = row * art.columns + col;
      const char = art.chars[cellIndex]!;
      if (char === ' ') continue;

      const next = style.color ? rgb(art.colors, cellIndex * 3) : style.foreground;
      if (next !== fill) {
        ctx.fillStyle = next;
        fill = next;
      }
      const x = offsetX + col * cw;
      const shade = SHADES[char];
      if (shade !== undefined) {
        // Snap to whole pixels so neighbouring cells meet without seams.
        const x0 = Math.round(x);
        ctx.globalAlpha = shade;
        ctx.fillRect(x0, y0, Math.round(x + cw) - x0, y1 - y0);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillText(char, x, y + baseline);
      }
    }
  }
}

function rgb(colors: Uint8Array, i: number): string {
  return `rgb(${colors[i]},${colors[i + 1]},${colors[i + 2]})`;
}
