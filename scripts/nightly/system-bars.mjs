import { pixels } from './report.mjs';

/** Compare adjacent backgrounds in a full-screen capture. Central pixels exclude
 * the clock/signal icons; callers may provide a cutout-free horizontal interval. */
export function systemBarDifference(png, { statusHeight, xStart = 0.25, xEnd = 0.75, threshold = 18 } = {}) {
  const { width, height, rgba } = pixels(png);
  if (!(statusHeight > 2 && statusHeight < height / 4)) throw Error('Real status-bar height is required');
  const x0 = Math.floor(width * xStart), x1 = Math.ceil(width * xEnd);
  const average = (y0, y1) => {
    const sum = [0, 0, 0]; let count = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      for (let c = 0; c < 3; c++) sum[c] += rgba[(y * width + x) * 4 + c];
      count++;
    }
    return sum.map(value => value / count);
  };
  const bar = average(1, Math.floor(statusHeight) - 1);
  // The first two content rows contain background, before any topbar text.
  const header = average(Math.ceil(statusHeight) + 1, Math.ceil(statusHeight) + 3);
  const delta = Math.sqrt(bar.reduce((sum, value, c) => sum + (value - header[c]) ** 2, 0) / 3);
  return { width, height, statusHeight, xStart, xEnd, bar, header, delta, threshold, passed: delta <= threshold };
}

export function assertSystemBars(png, options) {
  const result = systemBarDifference(png, options);
  if (!result.passed) throw Error(`System-bar background mismatch: ${result.delta.toFixed(2)} > ${result.threshold}`);
  return result;
}
