// Pure logic for comparing the ASCII preview with the original image. No
// DOM access, so it can be unit tested in Node.

/** ascii shows the art only, original the source only, compare splits them at a divider. */
export type View = 'ascii' | 'compare' | 'original';

export function isView(value: string | undefined): value is View {
  return value === 'ascii' || value === 'compare' || value === 'original';
}

/** Holding the peek key shows the original whatever the chosen view. */
export function effectiveView(view: View, peeking: boolean): View {
  return peeking ? 'original' : view;
}

/** Divider position in percent of the preview width, 0 to 100. */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.min(100, Math.max(0, value));
}

/** Divider position under a pointer at clientX over a box starting at left, width wide. */
export function percentAt(clientX: number, left: number, width: number): number {
  if (!(width > 0)) return 50;
  return clampPercent(((clientX - left) / width) * 100);
}

/**
 * New divider position for a key press on the slider handle, or undefined
 * if the key isn't one the slider handles. Arrows move 1% (10% with
 * Shift), Page Up/Down 10%, Home/End jump to the ends.
 */
export function keyStep(key: string, value: number, shift = false): number | undefined {
  const small = shift ? 10 : 1;
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowDown':
      return clampPercent(value - small);
    case 'ArrowRight':
    case 'ArrowUp':
      return clampPercent(value + small);
    case 'PageDown':
      return clampPercent(value - 10);
    case 'PageUp':
      return clampPercent(value + 10);
    case 'Home':
      return 0;
    case 'End':
      return 100;
    default:
      return undefined;
  }
}

/**
 * CSS clip-path for the original image, which lies exactly over the ASCII
 * preview. In compare view the original shows left of the divider.
 */
export function originalClip(view: View, percent: number): string {
  if (view === 'original') return 'inset(0)';
  if (view === 'ascii') return 'inset(0 100% 0 0)';
  return `inset(0 ${round(100 - clampPercent(percent))}% 0 0)`;
}

/** Screen-reader text for the slider value. */
export function valueText(percent: number): string {
  const p = Math.round(clampPercent(percent));
  return `${p}% original, ${100 - p}% ASCII`;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
