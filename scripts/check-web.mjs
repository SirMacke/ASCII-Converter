// End-to-end check of the web page in headless Chrome, driven over the
// DevTools protocol (Node 22+ has WebSocket built in).
//
//   npm run check:web                   # builds web/dist, serves it on :4173, checks it
//   node scripts/check-web.mjs <url>    # check a page that is already being served
//   npm run check:web -- --pages        # serve web/dist under /ASCII-Converter/ like GitHub Pages
//
// Set CHROME to the browser binary if it is not in a standard location.
// Checks: no page scroll at 1920x1080, 1440x900 and 1366x768 with large,
// tiny, very wide and very tall images; a tall image on a phone; keyboard
// access to the file picker; the font licence; exported image sizes,
// formats and square crops; GIF playback timing; messages surviving
// playback; WebM recording and video playback of that recording; exports
// reduced to fit iOS Safari's canvas limit.
// Exits 1 if anything fails.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import jpeg from 'jpeg-js';
import pngjs from 'pngjs';

const args = process.argv.slice(2);
// --pages serves web/dist under /ASCII-Converter/ on :4174, the way GitHub
// Pages does, and fails if the page requests anything outside that path.
const PAGES_BASE = '/ASCII-Converter/';
const pagesMode = args.includes('--pages');
const url =
  args.find((a) => !a.startsWith('--')) ?? (pagesMode ? `http://localhost:4174${PAGES_BASE}` : 'http://localhost:4173/');
// --readme also exports examples/spheres-ascii.png through the page, for the README.
const writeReadmeImage = args.includes('--readme');
const chromePath =
  process.env.CHROME ??
  [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find((p) => existsSync(p));
if (!chromePath) throw new Error('Chrome not found; set CHROME');

const work = mkdtempSync(join(tmpdir(), 'ascii-check-'));
const downloads = join(work, 'downloads');
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A large portrait test image (tall images are the hardest to fit), plus
// extreme shapes: 1x1, a 4000x50 strip and a 50x4000 strip.
const big = join(work, 'big.png');
const shapes = [
  ['tiny.png', 1, 1],
  ['wide.png', 4000, 50],
  ['tall.png', 50, 4000],
].map(([name, width, height]) => {
  const png = new pngjs.PNG({ width, height });
  for (let i = 0; i < width * height; i++) png.data.set([(i * 7) % 256, 128, 200, 255], i * 4);
  const path = join(work, name);
  writeFileSync(path, pngjs.PNG.sync.write(png));
  return { name, path, width, height };
});
{
  const width = 2400;
  const height = 3600;
  const png = new pngjs.PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const d = Math.hypot(x - width / 2, y - height / 2) / (width / 2);
      png.data[i] = (x * 255) / width;
      png.data[i + 1] = (y * 255) / height;
      png.data[i + 2] = d < 0.8 ? 230 : 40;
      png.data[i + 3] = 255;
    }
  }
  writeFileSync(big, pngjs.PNG.sync.write(png));
}

// Without an explicit URL, serve the built page (web/dist) ourselves.
let preview;
/** Requests outside the Pages base path (--pages): these would 404 on GitHub Pages. */
const outsideBase = [];
if (pagesMode && !args.some((a) => !a.startsWith('--'))) {
  const dist = fileURLToPath(new URL('../web/dist/', import.meta.url));
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.gif': 'image/gif', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain' };
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (!path.startsWith(PAGES_BASE)) {
      if (path !== '/favicon.ico') outsideBase.push(path);
      res.writeHead(404).end();
      return;
    }
    const file = normalize(join(dist, path.slice(PAGES_BASE.length) || 'index.html'));
    if (!file.startsWith(normalize(dist)) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(4174, resolve));
  preview = { kill: () => server.close() };
} else if (!args.some((a) => !a.startsWith('--'))) {
  const vite = new URL('../node_modules/vite/bin/vite.js', import.meta.url);
  preview = spawn(process.execPath, [fileURLToPath(vite), 'preview', '--port', '4173', '--strictPort'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    stdio: 'ignore',
  });
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(url)).ok) break;
    } catch {}
    if (i > 150 || preview.exitCode !== null) {
      preview.kill();
      throw new Error('vite preview did not start on port 4173 (is it in use?)');
    }
    await sleep(100);
  }
}

const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    '--remote-debugging-port=0',
    `--user-data-dir=${join(work, 'profile')}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);

try {
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    chrome.stderr.on('data', (d) => {
      buf += d;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
      if (m) resolve(m[1]);
    });
    chrome.on('exit', () => reject(new Error(`Chrome exited: ${buf}`)));
  });

  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let nextId = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
    else p.resolve(msg.result);
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject, method });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });

  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const page = (method, params) => send(method, params, sessionId);

  const evaluate = async (expression) => {
    const res = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) throw new Error(`${expression}: ${res.exceptionDetails.exception?.description}`);
    return res.result.value;
  };
  const waitFor = async (expression, timeout = 15000) => {
    const end = Date.now() + timeout;
    for (;;) {
      // The page may still be loading (elements missing), so an exception means "not yet".
      let value, error;
      try { value = await evaluate(expression); } catch (e) { error = e; }
      if (value) return value;
      if (Date.now() > end) throw error ?? new Error(`Timed out waiting for ${expression}`);
      await sleep(100);
    }
  };
  const setFile = async (path) => {
    const { root } = await page('DOM.getDocument', {});
    const { nodeId } = await page('DOM.querySelector', { nodeId: root.nodeId, selector: '#file' });
    await page('DOM.setFileInputFiles', { nodeId, files: [path] });
  };
  const setControl = (id, value) =>
    evaluate(`(() => {
      const el = document.getElementById(${JSON.stringify(id)});
      el.value = ${JSON.stringify(String(value))};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    })()`);
  const status = () => evaluate(`document.getElementById('status').textContent`);
  const info = () => evaluate(`document.getElementById('info').textContent`);
  const download = async (name, timeout = 20000) => {
    const end = Date.now() + timeout;
    const path = join(downloads, name);
    for (;;) {
      if (existsSync(path) && statSync(path).size > 0 && !readdirSync(downloads).some((f) => f.endsWith('.crdownload'))) {
        await sleep(200);
        const bytes = readFileSync(path);
        rmSync(path);
        return bytes;
      }
      if (Date.now() > end) {
        throw new Error(`No download named ${name}; found ${JSON.stringify(readdirSync(downloads))}, status "${await status()}"`);
      }
      await sleep(100);
    }
  };
  const pngSize = (b) => [b.readUInt32BE(16), b.readUInt32BE(20)];

  await page('Page.enable', {});
  await page('DOM.enable', {});

  const measure = () =>
    evaluate(`(() => {
      const r = (el) => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; };
      return {
        scrollHeight: document.documentElement.scrollHeight,
        innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth,
        canvas: r(document.getElementById('preview')),
        stage: r(document.getElementById('stage')),
        info: document.getElementById('info').textContent,
      };
    })()`);
  const fits = (m) =>
    m.scrollHeight <= m.innerHeight &&
    m.scrollWidth <= m.innerWidth &&
    m.canvas.top >= m.stage.top &&
    m.canvas.bottom <= m.stage.bottom &&
    m.canvas.left >= m.stage.left &&
    m.canvas.right <= m.stage.right;

  for (const [width, height] of [
    [1920, 1080],
    [1440, 900],
    [1366, 768],
  ]) {
    const tag = `${width}x${height}`;
    await page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await page('Page.navigate', { url });
    await waitFor(`/^spheres\\.png, 480×360 → /.test(document.getElementById('info').textContent)`);
    await setFile(big);
    await waitFor(`document.getElementById('info').textContent.includes('big.png, 2400×3600 →')`);

    for (const columns of [100, 300]) {
      await setControl('width', columns);
      const m = await evaluate(`(() => {
        const r = (el) => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; };
        const controls = document.getElementById('controls');
        return {
          scrollHeight: document.documentElement.scrollHeight,
          innerHeight,
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth,
          controlsOverflow: controls.scrollHeight - controls.clientHeight,
          canvas: r(document.getElementById('preview')),
          stage: r(document.getElementById('stage')),
          status: document.getElementById('info').textContent,
        };
      })()`);
      const inside =
        m.canvas.top >= m.stage.top && m.canvas.bottom <= m.stage.bottom && m.canvas.left >= m.stage.left && m.canvas.right <= m.stage.right;
      check(`${tag} width ${columns}: no vertical page scroll`, m.scrollHeight <= m.innerHeight, {
        scrollHeight: m.scrollHeight,
        innerHeight: m.innerHeight,
      });
      check(`${tag} width ${columns}: no horizontal page scroll`, m.scrollWidth <= m.innerWidth, {
        scrollWidth: m.scrollWidth,
        innerWidth: m.innerWidth,
      });
      check(`${tag} width ${columns}: controls fit without scrolling`, m.controlsOverflow <= 0, { overflow: m.controlsOverflow });
      check(`${tag} width ${columns}: whole preview inside the stage`, inside, { canvas: m.canvas, stage: m.stage, status: m.status });
    }
    const shot = await page('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(work, `page-${tag}.png`), Buffer.from(shot.data, 'base64'));

    for (const shape of shapes) {
      await setFile(shape.path);
      await waitFor(`document.getElementById('info').textContent.startsWith(${JSON.stringify(`${shape.name}, ${shape.width}×${shape.height}`)})`);
      const bad = [];
      for (const columns of [10, 100, 300]) {
        await setControl('width', columns);
        const m = await measure();
        if (!fits(m)) bad.push({ columns, ...m });
      }
      check(`${tag} ${shape.name}: no page scroll, preview inside the stage at widths 10/100/300`, bad.length === 0, bad[0]);
    }
  }

  // Narrow screens: vertical scrolling is fine, sideways overflow is not.
  {
    await page('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await page('Page.navigate', { url });
    await waitFor(`/^spheres\\.png, 480×360 → /.test(document.getElementById('info').textContent)`);
    const m = await evaluate(`({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth,
      canvasRight: document.getElementById('preview').getBoundingClientRect().right,
    })`);
    check('390x844: no horizontal scroll, preview fits the width', m.scrollWidth <= m.innerWidth && m.canvasRight <= m.innerWidth, m);
    const shot = await page('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(work, 'page-390x844.png'), Buffer.from(shot.data, 'base64'));

    // A tall strip used to ask for a 1000 x 34000 px canvas, which the browser refuses.
    const tall = shapes.find((s) => s.name === 'tall.png');
    await setFile(tall.path);
    await waitFor(`document.getElementById('info').textContent.startsWith('tall.png')`);
    for (const columns of [10, 300]) {
      await setControl('width', columns);
      const c = await evaluate(`(() => { const c = document.getElementById('preview'); return { width: c.width, height: c.height }; })()`);
      check(
        `390x844 tall.png width ${columns}: preview canvas within browser limits`,
        c.width <= 16384 && c.height <= 16384 && c.width * c.height <= 16777216,
        c,
      );
    }
    await page('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
    await page('Page.navigate', { url });
    await waitFor(`/^spheres\\.png, 480×360 → /.test(document.getElementById('info').textContent)`);
    await setFile(big);
    await waitFor(`document.getElementById('info').textContent.includes('big.png, 2400×3600 →')`);
  }

  // The file picker is reachable from the keyboard.
  const focused = await evaluate(
    `(() => { const f = document.getElementById('file'); f.focus(); return document.activeElement === f && f.tabIndex >= 0; })()`,
  );
  check('Open file is keyboard focusable', focused);

  // The bundled font's licence ships with the page.
  const licence = await evaluate(`fetch('./JetBrainsMono-OFL.txt').then((r) => (r.ok ? r.text() : ''))`);
  check('JetBrains Mono licence is served', licence.includes('SIL Open Font License'));

  // Export sizes and formats (1366x768 with big.png).
  await setControl('width', 100);
  await setControl('format', 'png');
  await setControl('size', '1024');
  await setControl('square', 'pad');
  await evaluate(`document.getElementById('export').click()`);
  let bytes = await download('big.png');
  check('PNG 1024 square padded is 1024x1024', pngSize(bytes).join('x') === '1024x1024', pngSize(bytes));

  // Square crop: whole cells and even margins, so no glyph is cut at the edges.
  await setControl('square', 'crop');
  await evaluate(`document.getElementById('export').click()`);
  bytes = await download('big.png');
  {
    const img = pngjs.PNG.sync.read(bytes);
    const band = 4;
    let inked = 0;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        if (x >= band && x < img.width - band && y >= band && y < img.height - band) continue;
        const i = (y * img.width + x) * 4;
        if (img.data[i] !== 0x0c || img.data[i + 1] !== 0x0c || img.data[i + 2] !== 0x0c) inked++;
      }
    }
    check('PNG 1024 square cropped is 1024x1024 with clear margins', img.width === 1024 && img.height === 1024 && inked === 0, {
      size: [img.width, img.height],
      inkedEdgePixels: inked,
    });
  }

  await setControl('square', 'none');
  await setControl('size', 'x2');
  const label = await evaluate(`document.getElementById('export-size').textContent`);
  await evaluate(`document.getElementById('export').click()`);
  bytes = await download('big.png');
  check('PNG 2x screen matches the size shown', label.startsWith(pngSize(bytes).join(' × ')), { label, actual: pngSize(bytes) });

  await setControl('format', 'jpeg');
  await setControl('size', '512');
  await evaluate(`document.getElementById('export').click()`);
  bytes = await download('big.jpg');
  const decoded = jpeg.decode(bytes);
  check('JPEG 512 wide is a JPEG 512 px wide', bytes[0] === 0xff && bytes[1] === 0xd8 && decoded.width === 512, [decoded.width, decoded.height]);

  await setControl('format', 'webp');
  await evaluate(`document.getElementById('export').click()`);
  bytes = await download('big.webp');
  check('WebP export is a WebP', bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP');

  // GIF playback: 30 frames at 50 ms, so about 20 frames per second.
  await setControl('sample', 'orbit');
  await waitFor(`document.getElementById('info').textContent.includes('orbit.gif')`);
  await waitFor(`document.getElementById('frame-info').textContent.startsWith('Frame')`);
  const frame = () => evaluate(`Number(document.getElementById('frame-info').textContent.match(/Frame (\\d+)/)[1])`);
  const f0 = await frame();
  const t0 = Date.now();
  await sleep(1500);
  const f1 = await frame();
  const fps = ((f1 - f0 + 30) % 30 || 30) / ((Date.now() - t0) / 1000);
  check('GIF plays at its frame delays (about 20 fps)', fps > 14 && fps < 24, { fps: Number(fps.toFixed(1)) });
  // Messages survive playback (frame updates used to overwrite them).
  await evaluate(`document.getElementById('export').click()`);
  await download('orbit.webp');
  await sleep(500);
  const message = await status();
  check('Export message stays visible while the GIF plays', message.startsWith('Saved orbit.webp'), message);
  await evaluate(`document.getElementById('play').click()`);
  const paused = await frame();
  await sleep(400);
  check('Pause stops the GIF', (await frame()) === paused);
  await evaluate(`document.getElementById('play').click()`);

  // Record one loop as WebM, then play the recording back as a video.
  await setControl('size', 'x1');
  await evaluate(`document.getElementById('record').click()`);
  bytes = await download('orbit.webm', 30000);
  check('Record WebM produces a WebM file', bytes.readUInt32BE(0) === 0x1a45dfa3 && bytes.length > 5000, { bytes: bytes.length });
  const video = join(work, 'orbit.webm');
  writeFileSync(video, bytes);
  await setFile(video);
  await waitFor(`document.getElementById('info').textContent.includes('orbit.webm')`);
  await waitFor(`/s$/.test(document.getElementById('frame-info').textContent)`);
  const time = () => evaluate(`parseFloat(document.getElementById('frame-info').textContent)`);
  const v0 = await time();
  await sleep(700);
  const v1 = await time();
  check('Video plays as live ASCII', v1 !== v0, { from: v0, to: v1 });
  const s = await info();
  check('Video frames are converted', /orbit\.webm, \d+×\d+ → \d+×\d+ characters/.test(s), s);

  // Compare with the original. The test image is green on the left half and
  // magenta on the right; with colour off the ASCII is grey on black, so a
  // screenshot sample tells original from ASCII.
  {
    const halves = join(work, 'halves.png');
    {
      const png = new pngjs.PNG({ width: 800, height: 400 });
      for (let i = 0; i < 800 * 400; i++) png.data.set(i % 800 < 400 ? [0, 200, 0, 255] : [200, 0, 200, 255], i * 4);
      writeFileSync(halves, pngjs.PNG.sync.write(png));
    }
    const setChecked = (id, on) =>
      evaluate(`(() => {
        const el = document.getElementById(${JSON.stringify(id)});
        if (el.checked !== ${on}) el.click();
        return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      })()`);
    const click = (selector) =>
      evaluate(`(() => {
        document.querySelector(${JSON.stringify(selector)}).click();
        return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      })()`);
    const rect = (id) =>
      evaluate(`(() => { const b = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; })()`);
    /** Share of green and magenta pixels in a 16x16 screenshot patch at a fraction of the preview box. */
    const sample = async (fx, fy = 0.5) => {
      const box = await rect('preview');
      const clip = { x: Math.round(box.x + fx * box.width) - 8, y: Math.round(box.y + fy * box.height) - 8, width: 16, height: 16, scale: 1 };
      const shot = await page('Page.captureScreenshot', { format: 'png', clip });
      const img = pngjs.PNG.sync.read(Buffer.from(shot.data, 'base64'));
      let green = 0;
      let magenta = 0;
      const n = img.width * img.height;
      for (let i = 0; i < n; i++) {
        const [r, g, b] = img.data.subarray(i * 4, i * 4 + 3);
        if (g > 150 && r < 60 && b < 60) green++;
        if (r > 150 && b > 150 && g < 60) magenta++;
      }
      return { green: green / n, magenta: magenta / n };
    };
    const shows = async (fx) => {
      const s = await sample(fx);
      return s.green > 0.9 ? 'green' : s.magenta > 0.9 ? 'magenta' : s.green < 0.1 && s.magenta < 0.1 ? 'ascii' : `mixed ${JSON.stringify(s)}`;
    };
    const key = async (name, code, keyCode, modifiers = 0) => {
      await page('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: name, code, windowsVirtualKeyCode: keyCode, modifiers });
      await page('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: keyCode, modifiers });
    };
    const sliderValue = () => evaluate(`Number(document.getElementById('divider-handle').getAttribute('aria-valuenow'))`);
    const aligned = async () => {
      const [a, b] = [await rect('preview'), await rect('original')];
      const sizes = await evaluate(`(() => { const p = document.getElementById('preview'), o = document.getElementById('original'); return [p.width, p.height, o.width, o.height]; })()`);
      return (
        Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5 &&
        sizes[0] === sizes[2] && sizes[1] === sizes[3]
      );
    };

    await page('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
    await page('Page.navigate', { url });
    await waitFor(`/^spheres\\.png, 480×360 → /.test(document.getElementById('info').textContent)`);
    await setFile(halves);
    await waitFor(`document.getElementById('info').textContent.startsWith('halves.png, 800×400')`);
    await setChecked('color', false);

    const initial = await evaluate(`({
      pressed: document.querySelector('[data-view="ascii"]').getAttribute('aria-pressed'),
      original: document.getElementById('original').hidden,
      divider: document.getElementById('divider').hidden,
    })`);
    check('Compare: starts as ASCII only', initial.pressed === 'true' && initial.original && initial.divider, initial);
    check('Compare: ASCII view shows no original', (await shows(0.25)) === 'ascii' && (await shows(0.75)) === 'ascii');

    // Exports and text with the default view, to compare against later.
    await setControl('format', 'png');
    await setControl('size', '512');
    await setControl('square', 'none');
    await evaluate(`document.getElementById('export').click()`);
    const pngBefore = await download('halves.png');
    await evaluate(`document.getElementById('download-txt').click()`);
    const txtBefore = await download('halves.txt');

    await click('[data-view="original"]');
    check('Original button shows the original everywhere', (await shows(0.25)) === 'green' && (await shows(0.75)) === 'magenta');
    check('Original lines up with the ASCII preview exactly', await aligned());
    await click('[data-view="ascii"]');
    check('ASCII button hides it again', (await shows(0.25)) === 'ascii' && (await shows(0.75)) === 'ascii');

    // Hold O to peek, with focus on the page.
    await evaluate(`document.activeElement?.blur()`);
    await page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'o', code: 'KeyO', windowsVirtualKeyCode: 79, text: 'o' });
    await sleep(50);
    const peek = [await shows(0.25), await shows(0.75)];
    await page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'o', code: 'KeyO', windowsVirtualKeyCode: 79 });
    await sleep(50);
    const after = [await shows(0.25), await shows(0.75)];
    check('Holding O peeks at the original; letting go returns', peek.join() === 'green,magenta' && after.join() === 'ascii,ascii', { peek, after });

    await click('[data-view="compare"]');
    const at50 = [await sliderValue(), await shows(0.25), await shows(0.75)];
    check('Compare at 50%: original on the left, ASCII on the right', at50.join() === '50,green,ascii', at50);

    // Keyboard on the focused handle.
    await evaluate(`document.getElementById('divider-handle').focus()`);
    await key('Home', 'Home', 36);
    const at0 = [await sliderValue(), await shows(0.25), await shows(0.75)];
    check('Compare at 0% (Home): ASCII everywhere', at0.join() === '0,ascii,ascii', at0);
    await key('End', 'End', 35);
    const at100 = [await sliderValue(), await shows(0.25), await shows(0.75)];
    check('Compare at 100% (End): original everywhere', at100.join() === '100,green,magenta', at100);
    await key('ArrowLeft', 'ArrowLeft', 37);
    const v1 = await sliderValue();
    await key('ArrowLeft', 'ArrowLeft', 37, 8); // Shift
    const v2 = await sliderValue();
    await key('PageDown', 'PageDown', 34);
    const v3 = await sliderValue();
    check('Arrow keys, Shift+Arrow and Page Down move the divider', [v1, v2, v3].join() === '99,89,79', [v1, v2, v3]);
    const a11y = await evaluate(`(() => { const h = document.getElementById('divider-handle'); return { role: h.getAttribute('role'), name: h.getAttribute('aria-label'), text: h.getAttribute('aria-valuetext'), tab: h.tabIndex }; })()`);
    check('Divider handle is a named, focusable slider with a value', a11y.role === 'slider' && Boolean(a11y.name) && a11y.text === '79% original, 21% ASCII' && a11y.tab === 0, a11y);

    // Mouse drag from the handle to 30%.
    {
      const h = await rect('divider-handle');
      const box = await rect('preview');
      const [x0, y] = [h.x + h.width / 2, h.y + h.height / 2];
      const x1 = box.x + box.width * 0.3;
      await page('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y, button: 'left', clickCount: 1 });
      await page('Input.dispatchMouseEvent', { type: 'mouseMoved', x: (x0 + x1) / 2, y, button: 'left' });
      await page('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y, button: 'left' });
      await page('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y, button: 'left', clickCount: 1 });
      const v = await sliderValue();
      check('Dragging with the mouse moves the divider', Math.abs(v - 30) <= 1, v);
    }

    // Touch drag from 30% to 70%.
    {
      const box = await rect('preview');
      const y = box.y + box.height / 2;
      const at = (f) => [{ x: box.x + box.width * f, y, id: 1 }];
      await page('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0.3) });
      await page('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(0.5) });
      await page('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(0.7) });
      await page('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(50);
      const v = await sliderValue();
      check('Dragging with touch moves the divider', Math.abs(v - 70) <= 1, v);
    }

    // Still lined up after an option change and at both desktop sizes, with no page scroll.
    await setControl('width', 180);
    check('Original still lines up after changing the width', await aligned());
    for (const [width, height] of [
      [1920, 1080],
      [1366, 768],
    ]) {
      await page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await sleep(300);
      const m = await measure();
      const overflow = await evaluate(`(() => { const c = document.getElementById('controls'); return c.scrollHeight - c.clientHeight; })()`);
      check(
        `${width}x${height} with compare on: no page scroll, controls fit, original lined up`,
        m.scrollHeight <= m.innerHeight && m.scrollWidth <= m.innerWidth && overflow <= 0 && (await aligned()),
        { scrollHeight: m.scrollHeight, innerHeight: m.innerHeight, overflow },
      );
    }
    await setControl('width', 100);

    // Exports are the same whatever the view.
    for (const v of ['compare', 'original']) {
      await click(`[data-view="${v}"]`);
      await evaluate(`document.getElementById('export').click()`);
      const png = await download('halves.png');
      await evaluate(`document.getElementById('download-txt').click()`);
      const txt = await download('halves.txt');
      check(`Exports are unchanged with the ${v} view on`, png.equals(pngBefore) && txt.equals(txtBefore), {
        png: png.length,
        before: pngBefore.length,
      });
    }

    // Phone: with the divider at either end the handle must not make anything scroll sideways.
    {
      await click('[data-view="compare"]');
      await page('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
      await sleep(300);
      await evaluate(`document.getElementById('divider-handle').focus()`);
      await key('Home', 'Home', 36);
      for (let i = 0; i < 5; i++) await key('PageUp', 'PageUp', 33);
      await sleep(100);
      const shot = await page('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(work, 'compare-1366x768.png'), Buffer.from(shot.data, 'base64'));
      await key('End', 'End', 35);
      await page('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await sleep(300);
      const bad = [];
      for (const [name, code, keyCode] of [
        ['Home', 'Home', 36],
        ['End', 'End', 35],
      ]) {
        await evaluate(`document.getElementById('divider-handle').focus({ preventScroll: true })`);
        await key(name, code, keyCode);
        const m = await evaluate(`(() => { const s = document.getElementById('stage'); return { doc: document.documentElement.scrollWidth, inner: innerWidth, stage: s.scrollWidth, stageClient: s.clientWidth }; })()`);
        if (m.doc > m.inner || m.stage > m.stageClient) bad.push({ key: name, ...m });
      }
      check('390x844 with compare on: no sideways scroll with the divider at either end', bad.length === 0 && (await aligned()), bad[0]);
      await page('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
      await sleep(200);
    }

    // GIF playback: the original follows the frames and stays lined up.
    await click('[data-view="compare"]');
    await setControl('sample', 'orbit');
    await waitFor(`document.getElementById('info').textContent.startsWith('orbit.gif')`);
    await waitFor(`document.getElementById('frame-info').textContent.startsWith('Frame')`);
    const snap = () => evaluate(`document.getElementById('original').toDataURL()`);
    const s0 = await snap();
    await sleep(300);
    const s1 = await snap();
    check('GIF playback: the original follows the frames and stays lined up', s0 !== s1 && (await aligned()));
    await click('[data-view="ascii"]');
  }

  // iOS Safari refuses canvases over 16.7 megapixels. Pretend to be an
  // iPhone on a big screen and ask for 4x the preview (about 30 MP).
  {
    const iphone =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
    await page('Emulation.setUserAgentOverride', { userAgent: iphone });
    await page('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await page('Page.navigate', { url });
    await waitFor(`/^spheres\\.png, 480×360 → /.test(document.getElementById('info').textContent)`);
    await setControl('format', 'png');
    await setControl('square', 'none');
    await setControl('size', 'x4');
    const label = await evaluate(`document.getElementById('export-size').textContent`);
    const m = /^(\d+) × (\d+) → (\d+) × (\d+) px, reduced to fit this browser$/.exec(label);
    check('iOS: a 4x export over 16.7 MP says it will be reduced', Boolean(m), label);
    await evaluate(`document.getElementById('export').click()`);
    bytes = await download('spheres.png');
    const [w, h] = pngSize(bytes);
    const ok =
      m !== null &&
      w === Number(m[3]) &&
      h === Number(m[4]) &&
      w * h <= 16_777_216 &&
      Math.abs(w / h - Number(m[1]) / Number(m[2])) < 0.01;
    check('iOS: the exported PNG is the reduced size, under 16.7 MP, same shape', ok, { label, actual: [w, h], pixels: w * h });
    const saved = await status();
    check('iOS: the save message mentions the reduction', saved.includes('reduced to fit this browser'), saved);
    await page('Emulation.setUserAgentOverride', { userAgent: '' });
  }

  if (writeReadmeImage) {
    await page('Page.navigate', { url });
    await waitFor(`/^spheres\\.png, 480×360 → /.test(document.getElementById('info').textContent)`);
    await setControl('width', 120);
    await setControl('gamma', 1.35);
    await setControl('size', '1024');
    await evaluate(`document.getElementById('export').click()`);
    bytes = await download('spheres.png');
    writeFileSync(new URL('../examples/spheres-ascii.png', import.meta.url), bytes);
    console.log(`wrote examples/spheres-ascii.png ${pngSize(bytes).join('x')}`);
  }

  if (pagesMode) {
    check(`Served from ${PAGES_BASE}: nothing requested outside it`, outsideBase.length === 0, outsideBase);
  }

  console.log(`\nScreenshots in ${work}`);
  ws.close();
} finally {
  chrome.kill();
  preview?.kill();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exitCode = failed ? 1 : 0;
