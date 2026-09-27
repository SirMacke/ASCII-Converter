import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import jpeg from 'jpeg-js';
import { GifWriter } from 'omggif';
import pngjs from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { joinNegativeValues, main, type CliIO } from '../src/cli/main.js';
import { gridSize } from '../src/core/index.js';
import { jpegSize } from '../src/node/decode.js';
import { MAX_PIXELS, decodeFrames, decodeImage, detectFormat, jpegOrientation } from '../src/node/index.js';

const root = new URL('..', import.meta.url);
const spheres = fileURLToPath(new URL('examples/spheres.png', root));
const orbit = fileURLToPath(new URL('examples/orbit.gif', root));
let dir: string;
let png: string;
let gif: string;

/** Encode an RGBA buffer as PNG. */
function makePng(width: number, height: number, rgba: number[]): Buffer {
  const img = new pngjs.PNG({ width, height });
  img.data = Buffer.from(rgba);
  return pngjs.PNG.sync.write(img);
}

/** Two 2x2 frames: black, then white, 20 ms each. */
function makeGif(): Buffer {
  const buf = new Uint8Array(1024);
  const writer = new GifWriter(buf, 2, 2, { palette: [0x000000, 0xffffff], loop: 0 });
  writer.addFrame(0, 0, 2, 2, [0, 0, 0, 0], { delay: 2 });
  writer.addFrame(0, 0, 2, 2, [1, 1, 1, 1], { delay: 2 });
  return Buffer.from(buf.subarray(0, writer.end()));
}

/** A 16x8 JPEG: left half black, right half white. */
function makeJpeg(): Buffer {
  const data = Buffer.alloc(16 * 8 * 4);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) data.fill(x < 8 ? 0 : 255, (y * 16 + x) * 4, (y * 16 + x) * 4 + 3);
  return jpeg.encode({ data, width: 16, height: 8 }, 100).data;
}

/** The same JPEG with EXIF saying "rotate 90 degrees clockwise to display". */
function makeRotatedJpeg(): Buffer {
  const encoded = makeJpeg();
  // prettier-ignore
  const app1 = Buffer.from([
    0xff, 0xe1, 0x00, 0x22,                   // APP1, length 34
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00,       // "Exif\0\0"
    0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 0x08,    // big-endian TIFF header, IFD at 8
    0x00, 0x01,                               // one entry
    0x01, 0x12, 0x00, 0x03, 0, 0, 0, 0x01,    // Orientation, SHORT, count 1
    0x00, 0x06, 0x00, 0x00,                   // value 6
    0, 0, 0, 0,                               // no next IFD
  ]);
  return Buffer.concat([encoded.subarray(0, 2), app1, encoded.subarray(2)]);
}

interface RunOptions {
  isTTY?: boolean;
  columns?: number;
  rows?: number;
  stdin?: Buffer;
  env?: Record<string, string>;
}

async function run(args: string[], opts: RunOptions = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = '';
  let stderr = '';
  const io = {
    stdout: { write: (s: string) => ((stdout += s), true), isTTY: opts.isTTY, columns: opts.columns, rows: opts.rows },
    stderr: { write: (s: string) => ((stderr += s), true) },
    stdin: Readable.from(opts.stdin ? [opts.stdin] : []),
    env: opts.env ?? {},
  } as unknown as CliIO;
  const code = await main(args, io);
  return { code, stdout, stderr };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'ascii-converter-'));
  png = join(dir, 'split.png');
  // 4x2: left half black, right half white.
  const px: number[] = [];
  for (let i = 0; i < 8; i++) px.push(...(i % 4 < 2 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
  writeFileSync(png, makePng(4, 2, px));
  gif = join(dir, 'blink.gif');
  writeFileSync(gif, makeGif());
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('cli', () => {
  it('prints help and version', async () => {
    const help = await run(['--help']);
    expect(help.code).toBe(0);
    expect(help.stdout).toMatch(/^Usage: ascii-converter <image> \[options\]/);
    const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as { version: string };
    expect((await run(['-v'])).stdout).toBe(`${pkg.version}\n`);
  });

  it('converts a PNG to exact text', async () => {
    const res = await run([png, '-w', '4', '--char-aspect', '1', '-r', ' #']);
    expect(res).toEqual({ code: 0, stdout: '  ##\n  ##\n', stderr: '' });
  });

  it('defaults to 80 columns when not writing to a terminal', async () => {
    const res = await run([spheres]);
    const lines = res.stdout.trimEnd().split('\n');
    const img = decodeImage(readFileSync(spheres));
    expect(res.code).toBe(0);
    expect(lines).toHaveLength(gridSize(img.width, img.height, { width: 80 }).rows);
    expect(lines.every((l) => l.length === 80)).toBe(true);
  });

  it('fits the terminal width when stdout is a TTY', async () => {
    const res = await run([spheres], { isTTY: true, columns: 50 });
    expect(res.stdout.split('\n')[0]).toHaveLength(49);
  });

  it('writes ANSI colour with the requested depth', async () => {
    const true24 = await run([png, '-w', '4', '-c', '--color-depth', 'truecolor']);
    expect(true24.stdout).toContain('\x1b[38;2;255;255;255m');
    const c256 = await run([png, '-w', '4', '-c'], { env: {} });
    expect(c256.stdout).toContain('\x1b[38;5;231m');
    const auto = await run([png, '-w', '4', '-c'], { env: { COLORTERM: 'truecolor' } });
    expect(auto.stdout).toContain('\x1b[38;2;');
  });

  it('writes text and HTML files with --out', async () => {
    const txt = join(dir, 'out.txt');
    const html = join(dir, 'out.html');
    expect((await run([png, '-w', '4', '--char-aspect', '1', '-r', ' #', '-o', txt])).code).toBe(0);
    expect(readFileSync(txt, 'utf8')).toBe('  ##\n  ##\n');
    expect((await run([spheres, '-w', '40', '-c', '-i', '-o', html])).code).toBe(0);
    const page = readFileSync(html, 'utf8');
    expect(page).toMatch(/^<!doctype html>/);
    expect(page).toContain('<title>spheres.png</title>');
    expect(page).toContain('<span style="color:#');
    expect(page).toContain('background: #fff');
  });

  it('reads the image from stdin with "-"', async () => {
    const res = await run(['-', '-w', '4', '--char-aspect', '1', '-r', ' #'], { stdin: readFileSync(png) });
    expect(res.stdout).toBe('  ##\n  ##\n');
  });

  it('shows the first GIF frame, or plays all frames with --animate', async () => {
    const still = await run([gif, '-w', '2', '--char-aspect', '1', '-r', ' #']);
    expect(still.stdout).toBe('  \n  \n');
    const anim = await run([gif, '-w', '2', '--char-aspect', '1', '-r', ' #', '--animate', '--loops', '1']);
    expect(anim.code).toBe(0);
    expect(anim.stdout).toBe('\x1b[?25l  \n  \r\x1b[1A##\n##\x1b[0m\x1b[?25h\n');
  });

  it('exits 2 on usage errors', async () => {
    for (const args of [[], [png, png], [png, '--nope'], [png, '-w', '0'], [png, '-w', 'ten'], [png, '-r', 'x'], [png, '--gamma', '0'], [png, '--color-depth', '16'], [gif, '-a', '-o', 'x.txt'], [png, '--loops', 'x']]) {
      const res = await run(args);
      expect(res.code, args.join(' ')).toBe(2);
      expect(res.stderr).toMatch(/^ascii-converter: .+\nRun "ascii-converter --help" for usage\.\n$/);
      expect(res.stdout).toBe('');
    }
  });

  it('exits 1 when the input cannot be read or decoded', async () => {
    const missing = await run([join(dir, 'nope.jpg')]);
    expect(missing).toMatchObject({ code: 1, stderr: expect.stringContaining('no such file') });
    const text = join(dir, 'notes.txt');
    writeFileSync(text, 'hello');
    expect(await run([text])).toMatchObject({ code: 1, stderr: expect.stringContaining('Unrecognised image format') });
    const webp = join(dir, 'x.webp');
    writeFileSync(webp, Buffer.from('RIFF\0\0\0\0WEBPVP8 '));
    expect(await run([webp])).toMatchObject({ code: 1, stderr: expect.stringContaining('WEBP images are not supported') });
    expect(await run([dir])).toMatchObject({ code: 1, stderr: expect.stringContaining('is a directory') });
  });

  it('runs as an executable from the build output', async () => {
    const bin = new URL('dist/cli/bin.js', root);
    const source = readFileSync(bin, 'utf8');
    expect(source.startsWith('#!/usr/bin/env node\n')).toBe(true);
    const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(bin), spheres, '-w', '30']);
    // 480x360 at 30 columns with 2:1 cells: round(30 * 0.75 / 2) = 11 rows.
    expect(stdout.trimEnd().split('\n')).toHaveLength(11);
  });

  it('accepts negative numbers after an option', async () => {
    const res = await run([png, '-w', '4', '--char-aspect', '1', '-r', ' #', '-b', '-0.6']);
    expect(res).toEqual({ code: 0, stdout: '    \n    \n', stderr: '' });
    expect((await run([png, '-w', '4', '--brightness', '-.6', '-r', ' #', '--char-aspect', '1'])).stdout).toBe('    \n    \n');
    expect(joinNegativeValues(['-b', '-0.2', '-g', '2', '--contrast', '-1', '-o', 'x', '--', '-b', '-1'])).toEqual([
      '--brightness=-0.2', '-g', '2', '--contrast=-1', '-o', 'x', '--', '-b', '-1',
    ]);
  });

  it('refuses to write text over an image or the input file', async () => {
    const copy = join(dir, 'copy.png');
    writeFileSync(copy, readFileSync(png));
    for (const out of [copy, join(dir, 'new.JPG')]) {
      const res = await run([copy, '-o', out]);
      expect(res.code).toBe(2);
      expect(res.stderr).toContain('not images');
    }
    const noExt = join(dir, 'image');
    writeFileSync(noExt, readFileSync(png));
    expect(await run([noExt, '-o', noExt])).toMatchObject({ code: 2, stderr: expect.stringContaining('refusing to overwrite') });
    expect(readFileSync(copy)).toEqual(readFileSync(png));
    expect(readFileSync(noExt)).toEqual(readFileSync(png));
  });

  it('plays an animation once when stdout is not a terminal', async () => {
    const res = await run([gif, '-w', '2', '--char-aspect', '1', '-r', ' #', '--animate']);
    expect(res.stdout).toBe('\x1b[?25l  \n  \r\x1b[1A##\n##\x1b[0m\x1b[?25h\n');
  });

  it('rejects absurd output sizes with a clear message', async () => {
    const res = await run([png, '-w', '100000']);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('Output would be 100000x25000 characters');
  });

  it('refuses images over the pixel limit before decoding them', async () => {
    const bomb = readFileSync(png);
    bomb.writeUInt32BE(60000, 16);
    bomb.writeUInt32BE(60000, 20);
    const file = join(dir, 'bomb.png');
    writeFileSync(file, bomb);
    expect(await run([file])).toMatchObject({ code: 1, stderr: expect.stringContaining('over the limit of 100,000,000 pixels') });
  });

  it('plays the example GIF', async () => {
    const res = await run([orbit, '-w', '20', '-a', '--loops', '1']);
    expect(res.code).toBe(0);
    // 30 frames: 29 cursor jumps back to the top of the previous frame.
    expect(res.stdout.match(/\r\x1b\[\d+A/g)).toHaveLength(29);
  });
});

describe('decoders', () => {
  it('detects formats from magic bytes', () => {
    expect(detectFormat(makeJpeg())).toBe('jpeg');
    expect(detectFormat(readFileSync(png))).toBe('png');
    expect(detectFormat(readFileSync(gif))).toBe('gif');
    expect(detectFormat(Buffer.from('BM'))).toBe('bmp');
    expect(detectFormat(Buffer.from('hello'))).toBeUndefined();
  });

  it('applies EXIF orientation to JPEGs', () => {
    const bytes = makeRotatedJpeg();
    expect(jpegOrientation(bytes)).toBe(6);
    expect(jpegOrientation(makeJpeg())).toBe(1);
    const img = decodeImage(bytes);
    expect([img.width, img.height]).toEqual([8, 16]);
    // Rotated clockwise: the black left half is now on top.
    expect(img.data[(3 * 8 + 4) * 4]).toBeLessThan(40);
    expect(img.data[(12 * 8 + 4) * 4]).toBeGreaterThan(215);
  });

  it('checks the pixel limit from the header of every format', () => {
    expect(jpegSize(makeJpeg())).toEqual({ width: 16, height: 8 });
    expect(() => decodeImage(makeJpeg(), { maxPixels: 127 })).toThrow(/16×8 pixels, over the limit of 127/);
    expect(decodeImage(makeJpeg(), { maxPixels: 128 }).width).toBe(16);
    expect(() => decodeImage(readFileSync(png), { maxPixels: 7 })).toThrow(RangeError);
    expect(() => decodeFrames(readFileSync(gif), { maxPixels: 3 })).toThrow(/2×2 pixels/);
    // A GIF whose logical screen claims 65535x65535.
    const huge = Buffer.from(makeGif());
    huge.writeUInt16LE(65535, 6);
    huge.writeUInt16LE(65535, 8);
    expect(() => decodeFrames(huge)).toThrow(/65535×65535 pixels/);
    expect(MAX_PIXELS).toBe(100_000_000);
  });

  it('names the format when a file is corrupt', () => {
    expect(() => decodeImage(readFileSync(png).subarray(0, 40))).toThrow(/^Could not decode PNG: /);
    expect(() => decodeImage(makeJpeg().subarray(0, 100))).toThrow(/^Could not decode JPEG: /);
  });

  it('decodes every GIF frame with its delay', () => {
    const frames = decodeFrames(readFileSync(gif));
    expect(frames).toHaveLength(2);
    expect(frames.map((f) => f.delay)).toEqual([20, 20]);
    expect(frames[0]!.data[0]).toBe(0);
    expect(frames[1]!.data[0]).toBe(255);
    const example = decodeFrames(readFileSync(orbit));
    expect(example).toHaveLength(30);
    expect(example.every((f) => f.delay === 50 && f.width === 240 && f.height === 180)).toBe(true);
  });
});
