import { IOS_CANVAS_AREA, isAppleMobile, usableArea, type AreaKnowledge, type CanvasLimits } from './layout.js';

/** Sides worth probing. The page never exports more than 8192 px on a side. */
const SIDES = [8192, 4096, 2048];

let maxSide: number | undefined;
const area: AreaKnowledge = { ok: 0, fail: Infinity };

/**
 * Whether the browser really draws into a canvas this size. Oversized
 * canvases don't throw everywhere: iOS Safari hands out a context that
 * silently ignores drawing, so check a pixel in the far corner.
 */
function canDraw(width: number, height: number): boolean {
  const canvas = document.createElement('canvas');
  try {
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    ctx.fillStyle = '#fff';
    ctx.fillRect(width - 1, height - 1, 1, 1);
    return ctx.getImageData(width - 1, height - 1, 1, 1).data[3] === 255;
  } catch {
    return false;
  } finally {
    // Release the memory straight away.
    canvas.width = 0;
    canvas.height = 0;
  }
}

/**
 * Canvas limits for an export of `requestedArea` pixels. The side is probed
 * once with 1-pixel-tall strips (cheap). Areas are probed only when an
 * export needs more than is already known to work, and results are cached.
 */
export function canvasLimits(requestedArea: number): CanvasLimits {
  if (maxSide === undefined) {
    maxSide = SIDES.find((side) => canDraw(side, 1)) ?? 1024;
    if (isAppleMobile(navigator)) area.fail = Math.min(area.fail, IOS_CANVAS_AREA + 1);
  }
  const side = maxSide;
  const wanted = Math.min(requestedArea, side * side);
  const maxArea = usableArea(wanted, area, (a) => {
    const w = Math.min(side, Math.ceil(Math.sqrt(a)));
    return canDraw(w, Math.ceil(a / w));
  });
  return { maxSide: side, maxArea };
}
