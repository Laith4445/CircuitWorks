import { describe, it, expect } from 'vitest';
import { linearTicks, logTicks, logRangeTicks, decimate, nearestIndex } from './scale';
import { unwrap, valueAt } from '../traces';

describe('axis ticks', () => {
  it('linear ticks are nice multiples that cover the data', () => {
    const t = linearTicks(0, 0.2, 6);
    expect(t.lo).toBeLessThanOrEqual(0);
    expect(t.hi).toBeGreaterThanOrEqual(0.2);
    expect(t.ticks.length).toBeGreaterThan(3);
    expect(t.ticks.length).toBeLessThan(15);
  });
  it('a flat trace still gets a sensible axis', () => {
    const t = linearTicks(2, 2, 5);
    expect(t.lo).toBeLessThan(2);
    expect(t.hi).toBeGreaterThan(2);
  });
  it('log ticks are decades', () => {
    expect(logTicks(1e5, 1e7).ticks).toEqual([1e5, 1e6, 1e7]);
  });
  it('a zoomed log axis gets 1-2-5 ticks, and a tight zoom gets linear ticks', () => {
    expect(logRangeTicks(2e5, 3e6).ticks).toEqual([2e5, 5e5, 1e6, 2e6]);
    const tight = logRangeTicks(9e5, 1.1e6);
    expect(tight.ticks.length).toBeGreaterThan(2);
    expect(tight.ticks.every((v) => v >= 9e5 && v <= 1.1e6)).toBe(true);
  });
});

describe('decimation keeps peaks', () => {
  it('a spike survives when 100k points squeeze into 300 pixels', () => {
    const n = 100000;
    const px = new Float64Array(n), py = new Float64Array(n);
    for (let k = 0; k < n; k++) { px[k] = (k / n) * 300; py[k] = 0; }
    py[54321] = 99;
    const d = decimate(px, py, 300);
    expect(d.length).toBeLessThan(4 * 300);
    let max = -Infinity;
    for (let k = 1; k < d.length; k += 2) max = Math.max(max, d[k]);
    expect(max).toBe(99);
  });
  it('small series pass through untouched', () => {
    const d = decimate(new Float64Array([0, 1, 2]), new Float64Array([5, 6, 7]), 300);
    expect([...d]).toEqual([0, 5, 1, 6, 2, 7]);
  });
});

describe('cursor helpers', () => {
  it('nearestIndex picks the closest sample', () => {
    const xs = new Float64Array([0, 1, 2, 3]);
    expect(nearestIndex(xs, 1.4)).toBe(1);
    expect(nearestIndex(xs, 1.6)).toBe(2);
    expect(nearestIndex(xs, -5)).toBe(0);
    expect(nearestIndex(xs, 50)).toBe(3);
  });
  it('valueAt interpolates', () => {
    const t = { id: 'a', label: 'a', color: '#000', unit: 'V', x: new Float64Array([0, 1]), y: new Float64Array([0, 10]) };
    expect(valueAt(t, 0.25)).toBeCloseTo(2.5);
  });
  it('phase unwrap removes 360° jumps but keeps a continuous response continuous', () => {
    const p = new Float64Array([170, 179, -179, -170]);
    unwrap(p);
    expect([...p]).toEqual([170, 179, 181, 190]);
  });
});
