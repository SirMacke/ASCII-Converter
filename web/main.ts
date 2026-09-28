import '@fontsource/jetbrains-mono/latin-400.css';
import { convert, toHtml, toText, type AsciiArt, type ConvertOptions, type PixelData } from '../src/core/index.js';
import orbitUrl from '../examples/orbit.gif';
import spheresUrl from '../examples/spheres.png';
import { drawArt, measureCell, type DrawStyle } from './draw.js';
import {
  FORMATS,
  capFontSize,
  exportLayout,
  fitFontSize,
  isExportFormat,
  parseSize,
  sliceArt,
  type CellMetrics,
  type SquareMode,
} from './layout.js';
import { canvasLimits } from './canvas-limits.js';
import { clampPercent, effectiveView, isView, keyStep, originalClip, percentAt, valueText, type View } from './compare.js';
import { closeSource, frameOf, openFile, type Source } from './media.js';

const FONTS: Record<string, string> = {
  jetbrains: '"JetBrains Mono", monospace',
  system: 'ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace',
  courier: '"Courier New", Courier, monospace',
};
const THEMES = {
  dark: { bg: '#0c0c0c', fg: '#d8d8d8' },
  light: { bg: '#ffffff', fg: '#1a1a1a' },
};
const SAMPLES: Record<string, { url: string; name: string }> = {
  spheres: { url: spheresUrl, name: 'spheres.png' },
  orbit: { url: orbitUrl, name: 'orbit.gif' },
};
/** Margin around exported images, in multiples of the font size. */
const EXPORT_PADDING = 1;
/** Inner padding of the stage, in CSS pixels. */
const STAGE_PADDING = 12;
/**
 * Most rows the page converts to. Only very tall images reach it (a 1:8
 * strip at 100 columns); beyond it the preview can't fit a desktop window
 * at a visible font size, so the width shrinks instead.
 */
const MAX_ROWS = 400;

const byId = <T extends HTMLElement = HTMLInputElement>(id: string): T => document.getElementById(id) as T;

const controls = byId<HTMLFormElement>('controls');
const fileInput = byId('file');
const sample = byId<HTMLSelectElement>('sample');
const playback = byId('playback');
const playButton = byId<HTMLButtonElement>('play');
const frameInfo = byId('frame-info');
const width = byId('width');
const ramp = byId<HTMLSelectElement>('ramp');
const customRamp = byId('custom-ramp');
const brightness = byId('brightness');
const contrast = byId('contrast');
const gamma = byId('gamma');
const invert = byId('invert');
const color = byId('color');
const dither = byId('dither');
const font = byId<HTMLSelectElement>('font');
const bg = byId('bg');
const fg = byId('fg');
const format = byId<HTMLSelectElement>('format');
const size = byId<HTMLSelectElement>('size');
const square = byId<HTMLSelectElement>('square');
const transparent = byId('transparent');
const quality = byId('quality');
const exportSize = byId('export-size');
const recordButton = byId<HTMLButtonElement>('record');
const stage = byId('stage');
const preview = byId<HTMLCanvasElement>('preview');
const status = byId('status');
const info = byId('info');
const compareBox = byId('compare-box');
const original = byId<HTMLCanvasElement>('original');
const divider = byId('divider');
const handle = byId('divider-handle');
const viewButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-view]'));

let source: Source | undefined;
let art: AsciiArt | undefined;
let cell: CellMetrics = { width: 0.6, height: 1.2, ascent: 0.95 };
let previewFontSize = 10;
let baseName = 'ascii-art';
let pending = 0;
let playing = false;
let gifIndex = 0;
let gifTimer = 0;
let gifDeadline = 0;
let coloursTouched = false;
let loadToken = 0;
/** Bumped by play() and pause() so a superseded video frame loop stops. */
let playToken = 0;
/** Compare view: what is shown over the preview. Starts as ASCII only. */
let view: View = 'ascii';
/** True while the peek key (O) is held down. */
let peeking = false;
/** Divider position in percent of the preview width. */
let dividerPercent = 50;
/** Pointer currently dragging the divider. */
let dragPointer: number | undefined;
/** The exact pixels behind the current art, drawn as the original. */
let shownPixels: PixelData | undefined;

interface Recording {
  recorder: MediaRecorder;
  ctx: CanvasRenderingContext2D;
  framesLeft: number;
}
let recording: Recording | undefined;

// ---- conversion and preview ---------------------------------------------

function fontFamily(): string {
  return FONTS[font.value] ?? FONTS.system!;
}

function currentOptions(): ConvertOptions {
  return {
    width: Number(width.value),
    height: MAX_ROWS,
    ramp: ramp.value === 'custom' ? customRamp.value : ramp.value,
    brightness: Number(brightness.value),
    contrast: Number(contrast.value),
    gamma: Number(gamma.value),
    invert: invert.checked,
    dither: dither.checked,
    // The measured cell of the chosen font, so proportions match the output.
    charAspect: cell.height / cell.width,
  };
}

function style(fontSize: number, allowTransparent: boolean): DrawStyle {
  return {
    fontFamily: fontFamily(),
    fontSize,
    cell,
    foreground: fg.value,
    background: allowTransparent ? null : bg.value,
    color: color.checked,
  };
}

/** Convert the current frame and redraw everything that depends on it. */
function refresh(): void {
  pending = 0;
  for (const el of [width, brightness, contrast, gamma, quality]) byId(`${el.id}-value`).textContent = el.value;
  byId('custom-ramp-label').hidden = ramp.value !== 'custom';
  const fmt = FORMATS[isExportFormat(format.value) ? format.value : 'png'];
  byId('quality-label').hidden = !fmt.lossy;
  transparent.disabled = !fmt.alpha;
  stage.style.background = bg.value;
  if (!source) return;

  const rampMessage = 'A custom ramp needs at least 2 characters.';
  if (ramp.value === 'custom' && Array.from(customRamp.value).length < 2) {
    setStatus(rampMessage);
    return;
  }
  if (status.textContent === rampMessage) setStatus('');
  shownPixels = frameOf(source, gifIndex);
  art = convert(shownPixels, currentOptions());
  drawPreview();
  updateExportSize();
  if (recording) drawRecordingFrame(recording);

  setText(info, `${source.label}, ${source.width}×${source.height} → ${art.columns}×${art.rows} characters`);
  if (source.kind === 'gif') frameInfo.textContent = `Frame ${gifIndex + 1} / ${source.frames.length}`;
  if (source.kind === 'video') {
    const { currentTime, duration } = source.video;
    // Recorded WebM files often have no duration in their header.
    frameInfo.textContent = Number.isFinite(duration)
      ? `${currentTime.toFixed(1)} / ${duration.toFixed(1)} s`
      : `${currentTime.toFixed(1)} s`;
  }
}

function schedule(): void {
  if (!pending) pending = requestAnimationFrame(refresh);
}

/**
 * Size the preview so the whole grid fits the stage. On narrow screens only
 * the width is fitted and the page scrolls.
 */
function drawPreview(): void {
  if (!art) return;
  const narrow = matchMedia('(max-width: 760px)').matches;
  const dpr = window.devicePixelRatio || 1;
  const fitted = fitFontSize(
    art.columns,
    art.rows,
    cell,
    {
      width: stage.clientWidth - 2 * STAGE_PADDING,
      height: narrow ? undefined : stage.clientHeight - 2 * STAGE_PADDING,
    },
    { min: 0.5, max: 24 },
  );
  // Tall art on a phone would otherwise ask for a canvas the browser refuses.
  previewFontSize = capFontSize(fitted, art.columns, art.rows, cell, dpr);
  const cssWidth = Math.floor(art.columns * cell.width * previewFontSize);
  const cssHeight = Math.floor(art.rows * cell.height * previewFontSize);
  preview.width = Math.max(1, Math.round(cssWidth * dpr));
  preview.height = Math.max(1, Math.round(cssHeight * dpr));
  preview.style.width = `${cssWidth}px`;
  preview.style.height = `${cssHeight}px`;
  const ctx = preview.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawArt(ctx, art, style(previewFontSize, false));
  drawOriginal();
}

// ---- compare with the original ---------------------------------------------

const pixelCanvas = document.createElement('canvas');

/**
 * Draw the pixels the art was converted from over the preview's whole box.
 * The converter spreads the image evenly over the character grid, so
 * stretching it to the preview canvas lines every cell up with the part of
 * the image it came from. Only the on-screen view uses this canvas; exports
 * draw from the art alone.
 */
function drawOriginal(): void {
  const shown = effectiveView(view, peeking);
  original.hidden = shown === 'ascii';
  divider.hidden = shown !== 'compare';
  compareBox.classList.toggle('comparing', shown === 'compare');
  original.style.clipPath = originalClip(shown, dividerPercent);
  if (shown === 'ascii' || !shownPixels) return;

  if (original.width !== preview.width) original.width = preview.width;
  if (original.height !== preview.height) original.height = preview.height;
  const { width: w, height: h } = shownPixels;
  if (pixelCanvas.width !== w || pixelCanvas.height !== h) {
    pixelCanvas.width = w;
    pixelCanvas.height = h;
  }
  const data =
    shownPixels instanceof ImageData
      ? shownPixels
      : new ImageData(Uint8ClampedArray.from(shownPixels.data), w, h);
  pixelCanvas.getContext('2d')!.putImageData(data, 0, 0);

  const ctx = original.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // Transparent parts show the page background, not the ASCII underneath.
  ctx.fillStyle = bg.value;
  ctx.fillRect(0, 0, original.width, original.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(pixelCanvas, 0, 0, original.width, original.height);
}

function setView(next: View): void {
  view = next;
  for (const button of viewButtons) button.setAttribute('aria-pressed', String(button.dataset.view === view));
  drawOriginal();
}

function setDivider(percent: number): void {
  dividerPercent = clampPercent(percent);
  divider.style.left = `${dividerPercent}%`;
  handle.setAttribute('aria-valuenow', String(Math.round(dividerPercent)));
  handle.setAttribute('aria-valuetext', valueText(dividerPercent));
  original.style.clipPath = originalClip(effectiveView(view, peeking), dividerPercent);
}

function dividerAt(e: PointerEvent): void {
  const box = preview.getBoundingClientRect();
  setDivider(percentAt(e.clientX, box.left, box.width));
}

function setPeeking(on: boolean): void {
  if (peeking === on) return;
  peeking = on;
  drawOriginal();
}

/** Typing an "o" into a text field or list shouldn't peek. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && ['text', 'search', 'url', 'email', 'number', 'password'].includes(target.type);
}

/** Messages (saved, errors). Kept apart from the per-frame info line so playback doesn't wipe them. */
function setStatus(text: string): void {
  status.textContent = text;
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

/** The cells an export draws: everything, or the square block when cropping. */
function exportArt(layout: ReturnType<typeof exportLayout>): AsciiArt {
  return sliceArt(art!, layout.region);
}

// ---- export ---------------------------------------------------------------

function currentExportLayout() {
  if (!art) return undefined;
  const input = {
    columns: art.columns,
    rows: art.rows,
    cell,
    size: parseSize(size.value),
    screenFontSize: previewFontSize,
    square: square.value as SquareMode,
    padding: EXPORT_PADDING,
  };
  // Work out the size asked for, then shrink it to what this browser can draw.
  const wanted = exportLayout(input);
  return exportLayout({ ...input, limits: canvasLimits(wanted.width * wanted.height) });
}

function updateExportSize(): void {
  const layout = currentExportLayout();
  if (!layout) return setText(exportSize, '');
  const { width: w, height: h, requested } = layout;
  setText(
    exportSize,
    layout.reduced
      ? `${requested.width} × ${requested.height} → ${w} × ${h} px, reduced to fit this browser`
      : `${w} × ${h} px${layout.limited ? ' (max)' : ''}`,
  );
}

async function exportImage(): Promise<void> {
  const layout = currentExportLayout();
  if (!art || !layout) return;
  const key = isExportFormat(format.value) ? format.value : 'png';
  const fmt = FORMATS[key];
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return setStatus('Could not create a canvas that large.');
  drawArt(ctx, exportArt(layout), style(layout.fontSize, transparent.checked && fmt.alpha), layout.offsetX, layout.offsetY);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, fmt.mime, fmt.lossy ? Number(quality.value) : undefined),
  );
  if (!blob) return setStatus('Export failed. Try a smaller size.');
  // Browsers that can't encode a format silently fall back to PNG.
  const ext = blob.type === fmt.mime ? fmt.ext : 'png';
  save(blob, `${baseName}.${ext}`);
  setStatus(
    blob.type === fmt.mime
      ? `Saved ${baseName}.${ext}, ${layout.width}×${layout.height}${layout.reduced ? ' (reduced to fit this browser)' : ''}.`
      : `This browser can't encode ${key.toUpperCase()}; saved a PNG instead.`,
  );
}

function save(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ---- recording animations to WebM ---------------------------------------

function startRecording(): void {
  if (!source || source.kind === 'still' || !art) return;
  if (typeof MediaRecorder === 'undefined') return setStatus('This browser cannot record video.');
  const layout = currentExportLayout()!;
  const canvas = document.createElement('canvas');
  // Video encoders want even dimensions.
  canvas.width = layout.width + (layout.width % 2);
  canvas.height = layout.height + (layout.height % 2);
  const ctx = canvas.getContext('2d')!;
  const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((t) =>
    MediaRecorder.isTypeSupported(t),
  );
  const recorder = new MediaRecorder(canvas.captureStream(), mimeType ? { mimeType, videoBitsPerSecond: 8_000_000 } : {});
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => chunks.push(e.data);
  recorder.onstop = () => {
    save(new Blob(chunks, { type: 'video/webm' }), `${baseName}.webm`);
    setStatus(`Saved ${baseName}.webm, ${canvas.width}×${canvas.height}.`);
  };

  // Record exactly one pass from the start.
  pause();
  if (source.kind === 'gif') {
    gifIndex = 0;
    recording = { recorder, ctx, framesLeft: source.frames.length - 1 };
  } else {
    const { video } = source;
    recording = { recorder, ctx, framesLeft: Infinity };
    video.loop = false;
    video.currentTime = 0;
    video.addEventListener('ended', stopRecording, { once: true });
  }
  recorder.start();
  recordButton.textContent = 'Stop recording';
  refresh();
  play();
}

function drawRecordingFrame(rec: Recording): void {
  const layout = currentExportLayout();
  if (!art || !layout) return;
  drawArt(rec.ctx, exportArt(layout), style(layout.fontSize, false), layout.offsetX, layout.offsetY);
}

function stopRecording(): void {
  if (!recording) return;
  recording.recorder.stop();
  recording = undefined;
  recordButton.textContent = 'Record WebM';
  if (source?.kind === 'video') {
    source.video.removeEventListener('ended', stopRecording);
    source.video.loop = true;
    if (source.video.ended) play();
  }
}

// ---- playback -------------------------------------------------------------

function play(): void {
  if (!source || source.kind === 'still') return;
  playing = true;
  const token = ++playToken;
  playButton.textContent = 'Pause';
  if (source.kind === 'gif') {
    scheduleGifFrame(source);
  } else {
    const { video } = source;
    void video.play();
    const step = (): void => {
      if (token !== playToken || source?.kind !== 'video' || source.video !== video) return;
      refresh();
      next();
    };
    const next = (): void => {
      if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(step);
      else requestAnimationFrame(step);
    };
    next();
  }
}

function scheduleGifFrame(gif: Extract<Source, { kind: 'gif' }>, continuing = false): void {
  clearTimeout(gifTimer);
  // Aim at absolute deadlines so conversion time doesn't stretch the delays.
  const now = performance.now();
  if (!continuing || gifDeadline < now - 1000) gifDeadline = now;
  gifDeadline += gif.frames[gifIndex]!.delay;
  gifTimer = window.setTimeout(() => {
    if (!playing || source !== gif) return;
    gifIndex = (gifIndex + 1) % gif.frames.length;
    refresh();
    if (recording && --recording.framesLeft === 0) {
      // Keep the last frame on screen for its full delay, then stop.
      window.setTimeout(stopRecording, gif.frames[gifIndex]!.delay);
    }
    scheduleGifFrame(gif, true);
  }, Math.max(0, gifDeadline - now));
}

function pause(): void {
  playing = false;
  playToken++;
  clearTimeout(gifTimer);
  if (source?.kind === 'video') source.video.pause();
  playButton.textContent = 'Play';
}

// ---- loading ----------------------------------------------------------------

async function load(file: Blob, label: string): Promise<void> {
  const token = ++loadToken;
  setStatus(`Loading ${label}…`);
  try {
    const next = await openFile(file, label);
    if (token !== loadToken) return closeSource(next);
    stopRecording();
    pause();
    closeSource(source);
    source = next;
    gifIndex = 0;
    baseName = label.replace(/\.[^.]+$/, '') || 'ascii-art';
    const animated = source.kind !== 'still';
    playback.hidden = !animated;
    recordButton.hidden = !animated;
    frameInfo.textContent = '';
    setStatus('');
    refresh();
    if (animated && !matchMedia('(prefers-reduced-motion: reduce)').matches) play();
  } catch (error) {
    setStatus(error instanceof Error && error.message ? error.message : `Could not open ${label}.`);
  }
}

async function loadSample(key: string): Promise<void> {
  const item = SAMPLES[key];
  if (!item) return;
  const res = await fetch(item.url);
  await load(await res.blob(), item.name);
}

async function applyFont(): Promise<void> {
  const family = fontFamily();
  try {
    await document.fonts.load(`16px ${family}`);
  } catch {
    // Fall through: measuring will use whatever font is available.
  }
  cell = measureCell(family);
  refresh();
}

// ---- events ---------------------------------------------------------------

controls.addEventListener('input', (e) => {
  const target = e.target as HTMLElement;
  if (target === bg || target === fg) coloursTouched = true;
  if (target === invert && !coloursTouched) {
    const theme = invert.checked ? THEMES.light : THEMES.dark;
    bg.value = theme.bg;
    fg.value = theme.fg;
  }
  if (target === font) return void applyFont();
  if (target === sample || target === fileInput) return;
  schedule();
});
controls.addEventListener('submit', (e) => e.preventDefault());
new ResizeObserver(() => schedule()).observe(stage);

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) void load(file, file.name);
  fileInput.value = '';
});
sample.addEventListener('change', () => {
  void loadSample(sample.value);
  sample.value = '';
});
playButton.addEventListener('click', () => (playing ? pause() : play()));
recordButton.addEventListener('click', () => (recording ? stopRecording() : startRecording()));
byId('export').addEventListener('click', () => void exportImage());

byId('copy').addEventListener('click', async () => {
  if (!art) return;
  try {
    await navigator.clipboard.writeText(toText(art));
    setStatus('Copied to clipboard.');
  } catch {
    setStatus('Copy failed. Download the .txt instead.');
  }
});
byId('download-txt').addEventListener('click', () => {
  if (art) save(new Blob([`${toText(art)}\n`], { type: 'text/plain;charset=utf-8' }), `${baseName}.txt`);
});
byId('download-html').addEventListener('click', () => {
  if (!art) return;
  const page = toHtml(art, { color: color.checked, standalone: true, theme: invert.checked ? 'light' : 'dark', title: baseName });
  save(new Blob([page], { type: 'text/html;charset=utf-8' }), `${baseName}.html`);
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
  const file = Array.from(e.clipboardData?.files ?? []).find((f) => /^(image|video)\//.test(f.type));
  if (file) void load(file, file.name || 'pasted image');
});

// Compare with the original: view buttons, divider drag and keys, hold O to peek.
for (const button of viewButtons) {
  button.addEventListener('click', () => {
    if (isView(button.dataset.view)) setView(button.dataset.view);
  });
}
compareBox.addEventListener('pointerdown', (e) => {
  if (effectiveView(view, peeking) !== 'compare' || e.button !== 0) return;
  dragPointer = e.pointerId;
  compareBox.setPointerCapture(e.pointerId);
  dividerAt(e);
  handle.focus({ preventScroll: true });
  e.preventDefault();
});
compareBox.addEventListener('pointermove', (e) => {
  if (e.pointerId === dragPointer) dividerAt(e);
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
  compareBox.addEventListener(type, (e) => {
    if (e.pointerId === dragPointer) dragPointer = undefined;
  });
}
handle.addEventListener('keydown', (e) => {
  const next = keyStep(e.key, dividerPercent, e.shiftKey);
  if (next === undefined) return;
  e.preventDefault();
  setDivider(next);
});
document.addEventListener('keydown', (e) => {
  if ((e.key === 'o' || e.key === 'O') && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e.target)) {
    setPeeking(true);
  }
});
document.addEventListener('keyup', (e) => {
  if (e.key === 'o' || e.key === 'O') setPeeking(false);
});
window.addEventListener('blur', () => setPeeking(false));
setDivider(dividerPercent);

await applyFont();
await loadSample('spheres');
