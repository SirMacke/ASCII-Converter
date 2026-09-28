import { describe, expect, it } from 'vitest';
import { clampPercent, effectiveView, isView, keyStep, originalClip, percentAt, valueText } from '../web/compare.js';

describe('compare view', () => {
  it('recognises the three views', () => {
    expect(['ascii', 'compare', 'original'].every(isView)).toBe(true);
    expect(isView('both')).toBe(false);
    expect(isView(undefined)).toBe(false);
  });

  it('shows the original while peeking, whatever the view', () => {
    expect(effectiveView('ascii', true)).toBe('original');
    expect(effectiveView('compare', true)).toBe('original');
    expect(effectiveView('compare', false)).toBe('compare');
    expect(effectiveView('ascii', false)).toBe('ascii');
  });
});

describe('divider position', () => {
  it('clamps to 0-100 and treats nonsense as the middle', () => {
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(140)).toBe(100);
    expect(clampPercent(37.5)).toBe(37.5);
    expect(clampPercent(Number.NaN)).toBe(50);
  });

  it('follows the pointer across the preview box', () => {
    // Box from x = 100 to x = 500.
    expect(percentAt(100, 100, 400)).toBe(0);
    expect(percentAt(300, 100, 400)).toBe(50);
    expect(percentAt(500, 100, 400)).toBe(100);
    expect(percentAt(200, 100, 400)).toBe(25);
    // Dragging past either edge pins the divider there.
    expect(percentAt(20, 100, 400)).toBe(0);
    expect(percentAt(900, 100, 400)).toBe(100);
    expect(percentAt(300, 100, 0)).toBe(50);
  });

  it('moves with the keyboard like a slider', () => {
    expect(keyStep('ArrowRight', 50)).toBe(51);
    expect(keyStep('ArrowUp', 50)).toBe(51);
    expect(keyStep('ArrowLeft', 50)).toBe(49);
    expect(keyStep('ArrowDown', 50)).toBe(49);
    expect(keyStep('ArrowRight', 50, true)).toBe(60);
    expect(keyStep('PageUp', 50)).toBe(60);
    expect(keyStep('PageDown', 50)).toBe(40);
    expect(keyStep('Home', 73)).toBe(0);
    expect(keyStep('End', 12)).toBe(100);
    expect(keyStep('ArrowRight', 99.5)).toBe(100);
    expect(keyStep('ArrowLeft', 0)).toBe(0);
    expect(keyStep('Enter', 50)).toBeUndefined();
    expect(keyStep('o', 50)).toBeUndefined();
  });
});

describe('originalClip', () => {
  it('hides, splits or shows the original', () => {
    expect(originalClip('ascii', 30)).toBe('inset(0 100% 0 0)');
    expect(originalClip('original', 30)).toBe('inset(0)');
    expect(originalClip('compare', 30)).toBe('inset(0 70% 0 0)');
    expect(originalClip('compare', 0)).toBe('inset(0 100% 0 0)');
    expect(originalClip('compare', 100)).toBe('inset(0 0% 0 0)');
    expect(originalClip('compare', 33.3333)).toBe('inset(0 66.667% 0 0)');
    expect(originalClip('compare', 150)).toBe('inset(0 0% 0 0)');
  });

  it('describes the value for screen readers', () => {
    expect(valueText(30)).toBe('30% original, 70% ASCII');
    expect(valueText(100)).toBe('100% original, 0% ASCII');
  });
});
