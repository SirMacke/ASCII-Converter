// Checks that TypeScript consumers can resolve the package's types for
// both entry points under every moduleResolution mode.
//
//   node scripts/check-types.mjs
//
// Packs the package, installs the tarball into throwaway projects with
// TypeScript 5.9 and 7, and runs tsc --noEmit on a file that imports "."
// and "./node". TypeScript 7 no longer supports node10, so node10 is only
// checked with 5.9. Needs network access to install TypeScript. Exits 1
// if any combination fails.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'ascii-types-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: 'pipe', shell: process.platform === 'win32' });

const CONSUMER = `import { RAMPS, asciify, convert, type AsciiArt, type ConvertOptions } from '@sirmacke/ascii-converter';
import { decodeImage, readImage, type DecodedImage } from '@sirmacke/ascii-converter/node';

const options: ConvertOptions = { width: 10, ramp: 'blocks' };
const image: DecodedImage = decodeImage(new Uint8Array(0));
const art: AsciiArt = convert(image, options);
const text: string = asciify(image, { color: '256' });
const later: Promise<DecodedImage> = readImage('photo.png');
// Proves the imports are typed rather than any.
// @ts-expect-error width must be a number
convert(image, { width: 'wide' });

export { RAMPS, art, text, later };
`;

const MODES = {
  node10: { module: 'commonjs', moduleResolution: 'node10' },
  node16: { module: 'node16', moduleResolution: 'node16' },
  nodenext: { module: 'nodenext', moduleResolution: 'nodenext' },
  bundler: { module: 'esnext', moduleResolution: 'bundler' },
};
const VERSIONS = [
  { ts: '5.9', modes: ['node10', 'node16', 'nodenext', 'bundler'] },
  { ts: '7', modes: ['node16', 'nodenext', 'bundler'] },
];

let failed = 0;
try {
  run(npm, ['pack', '--pack-destination', work], root);
  const tarball = join(work, readdirSync(work).find((f) => f.endsWith('.tgz')));

  for (const { ts, modes } of VERSIONS) {
    const dir = join(work, `ts${ts}`);
    mkdirSync(dir);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'consumer', private: true, type: 'module' }));
    writeFileSync(join(dir, 'index.ts'), CONSUMER);
    run(npm, ['install', '--no-audit', '--no-fund', tarball, `typescript@${ts}`], dir);
    const version = run('node', [join(dir, 'node_modules', 'typescript', 'bin', 'tsc'), '--version'], dir).trim();

    for (const mode of modes) {
      const config = `tsconfig.${mode}.json`;
      const compilerOptions = { ...MODES[mode], target: 'es2022', strict: true, noEmit: true, skipLibCheck: false, types: [] };
      writeFileSync(join(dir, config), JSON.stringify({ compilerOptions, files: ['index.ts'] }, null, 2));
      try {
        run('node', [join(dir, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', config], dir);
        console.log(`PASS  ${version.padEnd(14)} ${mode}`);
      } catch (error) {
        failed++;
        console.log(`FAIL  ${version.padEnd(14)} ${mode}\n${String(error.stdout || error.message).trim()}`);
      }
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(failed ? `${failed} combination(s) failed` : 'All combinations resolve types for both entry points');
process.exitCode = failed ? 1 : 0;
