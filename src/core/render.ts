import type { AsciiArt } from './convert.js';

export type ColorDepth = 'truecolor' | '256';

/** Plain text, one line per row, joined with "\n". */
export function toText(art: AsciiArt): string {
  const lines: string[] = [];
  for (let row = 0; row < art.rows; row++) {
    lines.push(art.chars.slice(row * art.columns, (row + 1) * art.columns).join(''));
  }
  return lines.join('\n');
}

/**
 * Text coloured with ANSI escape codes. `truecolor` uses 24-bit colour;
 * `256` maps each cell to the nearest xterm-256 colour for terminals
 * without truecolor support. Each coloured line ends with a reset.
 */
export function toAnsi(art: AsciiArt, depth: ColorDepth = 'truecolor'): string {
  const lines: string[] = [];
  for (let row = 0; row < art.rows; row++) {
    let line = '';
    let current = '';
    for (let col = 0; col < art.columns; col++) {
      const cell = row * art.columns + col;
      const char = art.chars[cell]!;
      // Spaces have no visible foreground, so don't switch colour for them.
      if (char !== ' ') {
        const r = art.colors[cell * 3]!;
        const g = art.colors[cell * 3 + 1]!;
        const b = art.colors[cell * 3 + 2]!;
        const code = depth === '256' ? `38;5;${rgbTo256(r, g, b)}` : `38;2;${r};${g};${b}`;
        if (code !== current) {
          line += `\x1b[${code}m`;
          current = code;
        }
      }
      line += char;
    }
    lines.push(current ? `${line}\x1b[0m` : line);
  }
  return lines.join('\n');
}

const CUBE = [0, 95, 135, 175, 215, 255];

/** Nearest xterm-256 palette index (6x6x6 cube or 24-step grey ramp). */
export function rgbTo256(r: number, g: number, b: number): number {
  const nearestCube = (v: number): number => (v < 48 ? 0 : v < 115 ? 1 : Math.min(5, Math.floor((v - 35) / 40)));
  const ri = nearestCube(r);
  const gi = nearestCube(g);
  const bi = nearestCube(b);
  const cubeDist = (CUBE[ri]! - r) ** 2 + (CUBE[gi]! - g) ** 2 + (CUBE[bi]! - b) ** 2;

  const grey = Math.min(23, Math.max(0, Math.round(((r + g + b) / 3 - 8) / 10)));
  const gv = 8 + grey * 10;
  const greyDist = (gv - r) ** 2 + (gv - g) ** 2 + (gv - b) ** 2;

  return greyDist < cubeDist ? 232 + grey : 16 + 36 * ri + 6 * gi + bi;
}

export interface HtmlOptions {
  /** Wrap runs of characters in coloured spans. Default false. */
  color?: boolean;
  /** Return a complete HTML document instead of a bare <pre> element. Default false. */
  standalone?: boolean;
  /** Page colours for standalone output. "light" suits inverted art. Default "dark". */
  theme?: 'dark' | 'light';
  /** Document title for standalone output. */
  title?: string;
}

/** Render as HTML: a <pre> element, or a full page with `standalone: true`. */
export function toHtml(art: AsciiArt, options: HtmlOptions = {}): string {
  const rows: string[] = [];
  for (let row = 0; row < art.rows; row++) {
    let line = '';
    let run = '';
    let runColor = '';
    const flush = (): void => {
      if (!run) return;
      line += runColor ? `<span style="color:${runColor}">${run}</span>` : run;
      run = '';
    };
    for (let col = 0; col < art.columns; col++) {
      const cell = row * art.columns + col;
      const char = art.chars[cell]!;
      if (options.color && char !== ' ') {
        const hex = toHex(art.colors, cell * 3);
        if (hex !== runColor) {
          flush();
          runColor = hex;
        }
      }
      run += escapeHtml(char);
    }
    flush();
    rows.push(line);
  }

  const pre = `<pre class="ascii-art">${rows.join('\n')}</pre>`;
  if (!options.standalone) return pre;

  const light = options.theme === 'light';
  const title = escapeHtml(options.title ?? 'ASCII art');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { margin: 0; padding: 24px; background: ${light ? '#fff' : '#0c0c0c'}; color: ${light ? '#111' : '#ddd'}; }
  .ascii-art { margin: 0; font: 10px/12px ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace; }
</style>
</head>
<body>
${pre}
</body>
</html>
`;
}

function toHex(colors: Uint8Array, offset: number): string {
  let hex = '#';
  for (let i = 0; i < 3; i++) hex += colors[offset + i]!.toString(16).padStart(2, '0');
  return hex;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'));
}
