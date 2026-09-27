import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { RAMPS, convert, toAnsi, toHtml, toText, type ColorDepth, type ConvertOptions } from '../core/index.js';
import { iterateFrames, type DecodedFrame } from '../node/decode.js';

export interface CliIO {
  stdout: NodeJS.WritableStream & { isTTY?: boolean; columns?: number; rows?: number };
  stderr: NodeJS.WritableStream;
  stdin: NodeJS.ReadableStream;
  env: Record<string, string | undefined>;
}

const NAME = 'ascii-converter';

const HELP = `Usage: ${NAME} <image> [options]

Convert a JPEG, PNG or GIF image to ASCII art. Use "-" to read the image from stdin.

Options:
  -w, --width <n>        Output width in characters (default: terminal width, or 80)
  -H, --height <n>       Maximum output height in rows
  -r, --ramp <ramp>      Characters from lightest to densest: a preset
                         (${Object.keys(RAMPS).join(', ')}) or your own string (default: standard)
  -i, --invert           Dense characters for dark pixels, for light backgrounds
  -c, --color            Colour the output: ANSI codes for text, coloured spans for HTML
      --color-depth <d>  truecolor or 256 (default: truecolor if the terminal reports it, else 256)
  -d, --dither           Dither between characters for smoother gradients
  -b, --brightness <n>   Brightness offset from -1 to 1 (default: 0)
      --contrast <n>     Contrast multiplier, 1 is unchanged (default: 1)
  -g, --gamma <n>        Gamma, above 1 brightens mid-tones (default: 1)
      --char-aspect <n>  Character cell height divided by width (default: 2)
  -a, --animate          Play an animated GIF in the terminal (Ctrl+C to stop)
      --loops <n>        With --animate, stop after n loops (default: forever in a
                         terminal, once when piped)
  -o, --out <file>       Write to a file. .html or .htm writes a web page, anything else
                         plain text. Image file names are refused.
  -h, --help             Show this help
  -v, --version          Show the version

Examples:
  ${NAME} photo.jpg
  ${NAME} photo.jpg --width 120 --color
  ${NAME} logo.png --invert --ramp blocks --out logo.html
  ${NAME} dance.gif --animate --color
`;

class UsageError extends Error {}

/** Run the CLI. Resolves to the process exit code. */
export async function main(argv: string[], io: CliIO = processIO()): Promise<number> {
  try {
    return await run(argv, io);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = (error as { code?: unknown } | null)?.code;
    if (error instanceof UsageError || (typeof code === 'string' && code.startsWith('ERR_PARSE_ARGS'))) {
      io.stderr.write(`${NAME}: ${message}\nRun "${NAME} --help" for usage.\n`);
      return 2;
    }
    io.stderr.write(`${NAME}: ${message}\n`);
    return 1;
  }
}

const OPTIONS = {
  width: { type: 'string', short: 'w' },
  height: { type: 'string', short: 'H' },
  ramp: { type: 'string', short: 'r' },
  invert: { type: 'boolean', short: 'i' },
  color: { type: 'boolean', short: 'c' },
  'color-depth': { type: 'string' },
  dither: { type: 'boolean', short: 'd' },
  brightness: { type: 'string', short: 'b' },
  contrast: { type: 'string' },
  gamma: { type: 'string', short: 'g' },
  'char-aspect': { type: 'string' },
  animate: { type: 'boolean', short: 'a' },
  loops: { type: 'string' },
  out: { type: 'string', short: 'o' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const;

/** File types --out refuses, because the CLI writes text and would clobber an image. */
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.avif']);

/**
 * parseArgs reads "-b -0.2" as a missing value followed by an unknown
 * option. Join a negative number onto the option before it so the obvious
 * spelling works.
 */
export function joinNegativeValues(argv: string[]): string[] {
  const takesValue = new Map<string, string>();
  for (const [name, spec] of Object.entries(OPTIONS)) {
    if (spec.type !== 'string') continue;
    takesValue.set(`--${name}`, name);
    if ('short' in spec) takesValue.set(`-${spec.short}`, name);
  }
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--') {
      out.push(...argv.slice(i));
      break;
    }
    const name = takesValue.get(arg);
    const next = argv[i + 1];
    if (name && next !== undefined && /^-(\d|\.\d)/.test(next)) {
      out.push(`--${name}=${next}`);
      i++;
    } else {
      out.push(arg);
    }
  }
  return out;
}

async function run(argv: string[], io: CliIO): Promise<number> {
  const { values, positionals } = parseArgs({ args: joinNegativeValues(argv), allowPositionals: true, options: OPTIONS });

  if (values.help) {
    io.stdout.write(HELP);
    return 0;
  }
  if (values.version) {
    io.stdout.write(`${version()}\n`);
    return 0;
  }
  if (positionals.length === 0) throw new UsageError('missing image path');
  if (positionals.length > 1) throw new UsageError(`expected one image, got ${positionals.length}`);
  if (values.animate && values.out) throw new UsageError('--animate cannot be combined with --out');

  const depth = values['color-depth'] ?? detectColorDepth(io.env);
  if (depth !== 'truecolor' && depth !== '256') {
    throw new UsageError(`--color-depth must be "truecolor" or "256", got "${depth}"`);
  }

  const toTerminal = !values.out && io.stdout.isTTY === true;
  const options: ConvertOptions = {
    width: int('--width', values.width),
    height: int('--height', values.height),
    ramp: values.ramp,
    invert: values.invert,
    dither: values.dither,
    brightness: num('--brightness', values.brightness),
    contrast: num('--contrast', values.contrast),
    gamma: num('--gamma', values.gamma),
    charAspect: num('--char-aspect', values['char-aspect']),
  };
  if (options.width === undefined && options.height === undefined) {
    options.width = toTerminal && io.stdout.columns ? Math.max(1, io.stdout.columns - 1) : 80;
  }
  try {
    // Validate the remaining options (ramp, ranges) on a 1x1 image before
    // touching the input. Width and height are already checked, and a 1x1
    // grid keeps this cheap whatever width was asked for.
    convert({ data: new Uint8Array(4), width: 1, height: 1 }, { ...options, width: 1, height: undefined });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  // Without a terminal to redraw in, play once unless asked otherwise.
  const loops = int('--loops', values.loops) ?? (io.stdout.isTTY === true ? 0 : 1);

  const source = positionals[0]!;
  if (values.out) {
    if (IMAGE_EXTENSIONS.has(extname(values.out).toLowerCase())) {
      throw new UsageError(`--out writes text or HTML, not images; use a .txt or .html file name, not "${values.out}"`);
    }
    if (source !== '-' && resolve(values.out) === resolve(source)) {
      throw new UsageError('--out is the input file; refusing to overwrite it');
    }
  }
  const bytes = source === '-' ? await readStream(io.stdin) : await readInput(source);
  if (bytes.length === 0) throw new Error('input is empty');
  const frames = iterateFrames(bytes, { firstOnly: !values.animate });
  const first = frames.next();
  if (first.done) throw new Error('image has no frames');

  const render = (art: ReturnType<typeof convert>): string =>
    values.color ? toAnsi(art, depth as ColorDepth) : toText(art);

  const second = values.animate ? frames.next() : undefined;
  if (second && !second.done) {
    if (options.height === undefined && toTerminal && io.stdout.rows) {
      // Cursor movement can only redraw what is on screen, so fit the height.
      options.height = Math.max(1, io.stdout.rows - 1);
    }
    // Convert frame by frame so only the text of each frame is kept.
    const rendered: { text: string; rows: number; delay: number }[] = [];
    const add = (frame: DecodedFrame): void => {
      const art = convert(frame, options);
      rendered.push({ text: render(art), rows: art.rows, delay: frame.delay });
    };
    add(first.value);
    add(second.value);
    for (const frame of frames) add(frame);
    return (await play(rendered, loops, io)) ? 130 : 0;
  }

  const art = convert(first.value, options);
  if (!values.out) {
    io.stdout.write(`${render(art)}\n`);
    return 0;
  }

  const ext = extname(values.out).toLowerCase();
  const output =
    ext === '.html' || ext === '.htm'
      ? toHtml(art, {
          color: values.color,
          standalone: true,
          theme: values.invert ? 'light' : 'dark',
          title: source === '-' ? 'ASCII art' : basename(source),
        })
      : `${render(art)}\n`;
  await writeFile(values.out, output, 'utf8');
  return 0;
}

/** Play rendered frames in place. Resolves to true if stopped with Ctrl+C. */
async function play(frames: { text: string; rows: number; delay: number }[], loops: number, io: CliIO): Promise<boolean> {
  const out = io.stdout;
  let stopped = false;
  let wake: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onSigint = (): void => {
    stopped = true;
    clearTimeout(timer);
    wake?.();
  };
  process.once('SIGINT', onSigint);
  out.write('\x1b[?25l'); // hide cursor
  try {
    let first = true;
    for (let loop = 0; !stopped && (loops === 0 || loop < loops); loop++) {
      for (const frame of frames) {
        if (stopped) break;
        // Jump back to the top-left of the previous frame and draw over it.
        if (!first) out.write(frame.rows > 1 ? `\r\x1b[${frame.rows - 1}A` : '\r');
        first = false;
        out.write(frame.text);
        await new Promise<void>((done) => {
          wake = done;
          timer = setTimeout(done, frame.delay);
        });
      }
    }
  } finally {
    process.off('SIGINT', onSigint);
    out.write('\x1b[0m\x1b[?25h\n'); // reset colour, show cursor
  }
  return stopped;
}

function detectColorDepth(env: CliIO['env']): ColorDepth {
  const colorterm = env.COLORTERM?.toLowerCase();
  if (colorterm === 'truecolor' || colorterm === '24bit') return 'truecolor';
  // Windows Terminal supports truecolor but does not set COLORTERM.
  if (env.WT_SESSION) return 'truecolor';
  return '256';
}

function num(flag: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (value.trim() === '' || !Number.isFinite(n)) throw new UsageError(`${flag} must be a number, got "${value}"`);
  return n;
}

function int(flag: string, value: string | undefined): number | undefined {
  const n = num(flag, value);
  if (n !== undefined && (!Number.isInteger(n) || n < 1)) {
    throw new UsageError(`${flag} must be a positive whole number, got "${value}"`);
  }
  return n;
}

async function readInput(path: string): Promise<Uint8Array> {
  try {
    return await readFile(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new Error(`no such file: ${path}`);
    if (code === 'EISDIR') throw new Error(`${path} is a directory, not an image`);
    throw error;
  }
}

async function readStream(stream: NodeJS.ReadableStream): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks);
}

function version(): string {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
  return pkg.version;
}

function processIO(): CliIO {
  return { stdout: process.stdout, stderr: process.stderr, stdin: process.stdin, env: process.env };
}
