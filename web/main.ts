import { convert, toHtml, toText, type AsciiArt, type ConvertOptions } from '../src/core/index.js';
import sampleUrl from '../examples/spheres.png';

// Images are scaled down to this many pixels on the long side once, on load.
// The converter averages pixels per character, so more detail is wasted.
const MAX_SIDE = 1200;

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const input = <T extends HTMLElement = HTMLInputElement>(id: string): T => byId<T>(id);

const controls = byId<HTMLFormElement>('controls');
const fileInput = input('file');
const width = input('width');
const ramp = input<HTMLSelectElement>('ramp');
const customRamp = input('custom-ramp');
const customRampLabel = byId('custom-ramp-label');
const brightness = input('brightness');
const contrast = input('contrast');
const gamma = input('gamma');
const invert = input('invert');
const color = input('color');
const dither = input('dither');
const stage = byId('stage');
const output = byId('output');
const status = byId('status');

let pixels: ImageData | undefined;
let art: AsciiArt | undefined;
let baseName = 'ascii-art';
let sourceLabel = '';
let pending = 0;

async function load(blob: Blob, label: string): Promise<void> {
  try {
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2D is not available');
    ctx.drawImage(bitmap, 0, 0, w, h);
    pixels = ctx.getImageData(0, 0, w, h);
    sourceLabel = `${label}, ${bitmap.width}×${bitmap.height}`;
    baseName = label.replace(/\.[^.]+$/, '') || 'ascii-art';
    bitmap.close();
    schedule();
  } catch {
    setStatus(`Could not read ${label} as an image.`);
  }
}

function currentOptions(): ConvertOptions {
  return {
    width: Number(width.value),
    ramp: ramp.value === 'custom' ? customRamp.value : ramp.value,
    brightness: Number(brightness.value),
    contrast: Number(contrast.value),
    gamma: Number(gamma.value),
    invert: invert.checked,
    dither: dither.checked,
    charAspect: cell.height / cell.width,
  };
}

function render(): void {
  pending = 0;
  for (const el of [width, brightness, contrast, gamma]) byId(`${el.id}-value`).textContent = el.value;
  customRampLabel.hidden = ramp.value !== 'custom';
  stage.classList.toggle('light', invert.checked);
  if (!pixels) return;

  if (ramp.value === 'custom' && Array.from(customRamp.value).length < 2) {
    setStatus('A custom ramp needs at least 2 characters.');
    return;
  }
  art = convert(pixels, currentOptions());
  output.innerHTML = toHtml(art, { color: color.checked }).replace(/^<pre[^>]*>|<\/pre>$/g, '');
  fitFont();
  setStatus(`${sourceLabel} → ${art.columns}×${art.rows} characters`);
}

function schedule(): void {
  if (!pending) pending = requestAnimationFrame(render);
}

// Measure the monospace cell so the aspect ratio matches what is on screen,
// then scale the font so the whole picture fits the stage width.
const cell = measureCell();

function measureCell(): { width: number; height: number } {
  const probe = document.createElement('pre');
  probe.className = 'ascii-art';
  probe.style.cssText = 'position:absolute;visibility:hidden;padding:0;margin:0;font-size:100px';
  probe.textContent = Array(10).fill('M'.repeat(10)).join('\n');
  document.body.append(probe);
  const rect = probe.getBoundingClientRect();
  probe.remove();
  return { width: rect.width / 1000, height: rect.height / 1000 };
}

function fitFont(): void {
  if (!art) return;
  const available = stage.clientWidth - 32;
  const size = Math.min(16, Math.max(3, available / (art.columns * cell.width)));
  output.style.fontSize = `${size.toFixed(2)}px`;
}

function setStatus(text: string): void {
  status.textContent = text;
}

function download(contents: string, type: string, ext: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${baseName}.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function loadSample(): Promise<void> {
  const res = await fetch(sampleUrl);
  await load(await res.blob(), 'spheres.png');
}

controls.addEventListener('input', schedule);
controls.addEventListener('submit', (e) => e.preventDefault());
new ResizeObserver(fitFont).observe(stage);

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) void load(file, file.name);
  fileInput.value = '';
});
byId('sample').addEventListener('click', () => void loadSample());

byId('copy').addEventListener('click', async () => {
  if (!art) return;
  try {
    await navigator.clipboard.writeText(toText(art));
    setStatus('Copied to clipboard.');
  } catch {
    setStatus('Copy failed. Select the text and copy it manually.');
  }
});
byId('download-txt').addEventListener('click', () => {
  if (art) download(`${toText(art)}\n`, 'text/plain;charset=utf-8', 'txt');
});
byId('download-html').addEventListener('click', () => {
  if (!art) return;
  const page = toHtml(art, { color: color.checked, standalone: true, theme: invert.checked ? 'light' : 'dark', title: baseName });
  download(page, 'text/html;charset=utf-8', 'html');
});

// Drag and drop anywhere on the page, or paste an image.
document.addEventListener('dragover', (e) => {
  e.preventDefault();
  stage.classList.add('dragging');
});
document.addEventListener('dragleave', (e) => {
  if (e.relatedTarget === null) stage.classList.remove('dragging');
});
document.addEventListener('drop', (e) => {
  e.preventDefault();
  stage.classList.remove('dragging');
  const file = e.dataTransfer?.files[0];
  if (file) void load(file, file.name);
});
document.addEventListener('paste', (e) => {
  const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'));
  if (file) void load(file, file.name || 'pasted image');
});

render();
void loadSample();
