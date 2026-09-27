import type { PixelData } from '../src/core/index.js';
import { decodeGifFrames } from '../src/formats/gif.js';

// Pixels are scaled down on load; the converter averages many pixels per
// character anyway. Moving sources use a smaller cap to keep playback fast.
const MAX_STILL_SIDE = 1200;
const MAX_MOTION_SIDE = 480;

export type Source =
  | { kind: 'still'; label: string; width: number; height: number; frame: PixelData }
  | { kind: 'gif'; label: string; width: number; height: number; frames: (PixelData & { delay: number })[] }
  | { kind: 'video'; label: string; width: number; height: number; video: HTMLVideoElement; url: string };

/** Open an image, animated GIF or video file. */
export async function openFile(file: Blob, label: string): Promise<Source> {
  const head = new Uint8Array(await file.slice(0, 6).arrayBuffer());
  const isGif = head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46;
  if (isGif) {
    const frames = decodeGifFrames(new Uint8Array(await file.arrayBuffer()));
    const { width, height } = frames[0]!;
    if (frames.length === 1) return { kind: 'still', label, width, height, frame: scale(frames[0]!, MAX_STILL_SIDE) };
    return {
      kind: 'gif',
      label,
      width,
      height,
      frames: frames.map((f) => ({ ...scale(f, MAX_MOTION_SIDE), delay: f.delay })),
    };
  }
  if (file.type.startsWith('video/')) return openVideo(file, label);
  try {
    return await openStill(file, label);
  } catch (error) {
    // Some video files arrive without a MIME type; try them as video.
    if (!file.type) return openVideo(file, label);
    throw error;
  }
}

async function openStill(file: Blob, label: string): Promise<Source> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const { width, height } = bitmap;
  const frame = draw(bitmap, width, height, MAX_STILL_SIDE);
  bitmap.close();
  return { kind: 'still', label, width, height, frame };
}

async function openVideo(file: Blob, label: string): Promise<Source> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = 'auto';
  try {
    await new Promise<void>((resolve, reject) => {
      video.addEventListener('loadeddata', () => resolve(), { once: true });
      video.addEventListener('error', () => reject(new Error('This browser cannot play that video.')), { once: true });
      video.src = url;
    });
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  return { kind: 'video', label, width: video.videoWidth, height: video.videoHeight, video, url };
}

/** The pixels to convert right now: a still, a GIF frame, or the current video frame. */
export function frameOf(source: Source, gifIndex: number): PixelData {
  switch (source.kind) {
    case 'still':
      return source.frame;
    case 'gif':
      return source.frames[gifIndex % source.frames.length]!;
    case 'video':
      return draw(source.video, source.width, source.height, MAX_MOTION_SIDE);
  }
}

export function closeSource(source: Source | undefined): void {
  if (source?.kind !== 'video') return;
  source.video.pause();
  source.video.removeAttribute('src');
  source.video.load();
  URL.revokeObjectURL(source.url);
}

const scratch = document.createElement('canvas');
const scratchCtx = scratch.getContext('2d', { willReadFrequently: true })!;

function draw(image: CanvasImageSource, width: number, height: number, maxSide: number): PixelData {
  const factor = Math.min(1, maxSide / Math.max(width, height));
  const w = Math.max(1, Math.round(width * factor));
  const h = Math.max(1, Math.round(height * factor));
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w;
    scratch.height = h;
  } else {
    scratchCtx.clearRect(0, 0, w, h);
  }
  scratchCtx.drawImage(image, 0, 0, w, h);
  return scratchCtx.getImageData(0, 0, w, h);
}

function scale(frame: PixelData, maxSide: number): PixelData {
  if (Math.max(frame.width, frame.height) <= maxSide) return frame;
  const canvas = document.createElement('canvas');
  canvas.width = frame.width;
  canvas.height = frame.height;
  const data = Uint8ClampedArray.from(frame.data);
  canvas.getContext('2d')!.putImageData(new ImageData(data, frame.width, frame.height), 0, 0);
  return draw(canvas, frame.width, frame.height, maxSide);
}
