/** Axis helpers for the hand-rolled plotter: nice ticks and min/max decimation. */

export function niceStep(range: number, targetTicks: number): number {
  if (!(range > 0)) return 1;
  const raw = range / Math.max(1, targetTicks);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const r = raw / mag;
  const nice = r < 1.5 ? 1 : r < 3.5 ? 2 : r < 7.5 ? 5 : 10;
  return nice * mag;
}

/** Ticks covering [min, max] at nice multiples; the returned bounds are expanded to whole steps. */
export function linearTicks(min: number, max: number, targetTicks = 5): { ticks: number[]; lo: number; hi: number } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { ticks: [0, 1], lo: 0, hi: 1 };
  if (min === max) { const pad = Math.abs(min) || 1; min -= pad; max += pad; }
  const step = niceStep(max - min, targetTicks);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step * 1e-9; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return { ticks, lo, hi };
}

/** Log-axis ticks: every decade between the bounds (bounds snapped to decades). */
export function logTicks(min: number, max: number): { ticks: number[]; lo: number; hi: number } {
  const lo = Math.pow(10, Math.floor(Math.log10(min)));
  const hi = Math.pow(10, Math.ceil(Math.log10(max)));
  const ticks: number[] = [];
  for (let v = lo; v <= hi * 1.0000001; v *= 10) ticks.push(v);
  return { ticks, lo, hi };
}

/**
 * Reduce a series to at most ~2 points per pixel column, keeping each column's
 * min and max so peaks survive. Returns [px, py] pairs in pixel space.
 */
export function decimate(px: Float64Array, py: Float64Array, width: number): Float64Array {
  const n = px.length;
  if (n <= 2 * width) {
    const out = new Float64Array(2 * n);
    for (let k = 0; k < n; k++) { out[2 * k] = px[k]; out[2 * k + 1] = py[k]; }
    return out;
  }
  const pts: number[] = [];
  let col = Math.floor(px[0]);
  let minI = 0, maxI = 0;
  for (let k = 1; k <= n; k++) {
    const c = k < n ? Math.floor(px[k]) : Infinity;
    if (c !== col) {
      const a = Math.min(minI, maxI), b = Math.max(minI, maxI);
      pts.push(px[a], py[a]);
      if (b !== a) pts.push(px[b], py[b]);
      if (k < n) { col = c; minI = k; maxI = k; }
    } else {
      if (py[k] < py[minI]) minI = k;
      if (py[k] > py[maxI]) maxI = k;
    }
  }
  return Float64Array.from(pts);
}

/** Index of the sample nearest to x (xs ascending). */
export function nearestIndex(xs: Float64Array, x: number): number {
  let lo = 0, hi = xs.length - 1;
  if (x <= xs[0]) return 0;
  if (x >= xs[hi]) return hi;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
  return x - xs[lo] < xs[hi] - x ? lo : hi;
}
