import { describe, it, expect } from 'vitest';
import { junctionPoints, unconnectedPins, hitTest, lowestPoint } from './geometry';
import { EXERCISES } from '../exercises';
import type { Circuit } from '../schematic/model';

const E1 = EXERCISES[0] as Circuit;

describe('junction dots', () => {
  it('E1 gets dots exactly where three or more things meet or a wire ends on another wire', () => {
    const pts = junctionPoints(E1).map((p) => p.join(',')).sort();
    expect(pts).toEqual(['120,140', '120,220', '120,60', '200,140'].sort());
  });
  it('a plain corner between two wires gets no dot', () => {
    const c: Circuit = { v: 1, grid: 10, parts: [], wires: [{ from: [0, 0], to: [50, 0] }, { from: [50, 0], to: [50, 50] }], probes: [], analysis: { kind: 'dc' }, labels: [] };
    expect(junctionPoints(c)).toEqual([]);
  });
  it('two pins touching with no wire get a dot', () => {
    const c: Circuit = { v: 1, grid: 10, parts: [{ id: 'R1', type: 'R', x: 100, y: 100, rot: 0 }, { id: 'R2', type: 'R', x: 140, y: 100, rot: 0 }], wires: [], probes: [], analysis: { kind: 'dc' }, labels: [] };
    expect(junctionPoints(c)).toEqual([[120, 100]]);
  });
});

describe('red (unconnected) pins', () => {
  it('every exercise circuit has none', () => {
    for (const ex of EXERCISES) expect([...unconnectedPins(ex as Circuit)]).toEqual([]);
  });
  it('a lone resistor has two', () => {
    const c: Circuit = { v: 1, grid: 10, parts: [{ id: 'R1', type: 'R', x: 100, y: 100, rot: 0 }], wires: [], probes: [], analysis: { kind: 'dc' }, labels: [] };
    expect([...unconnectedPins(c)].sort()).toEqual(['R1:a', 'R1:b']);
  });
  it('a wire crossing a pin without ending on it leaves the pin red', () => {
    const c: Circuit = { v: 1, grid: 10, parts: [{ id: 'R1', type: 'R', x: 100, y: 100, rot: 90 }], wires: [{ from: [60, 80], to: [140, 80] }], probes: [], analysis: { kind: 'dc' }, labels: [] };
    expect(unconnectedPins(c).has('R1:a')).toBe(true);
  });
});

describe('hit testing', () => {
  it('pins beat parts beat wires', () => {
    expect(hitTest(E1, [120, 80]).kind).toBe('pin');
    expect(hitTest(E1, [120, 100]).kind).toBe('part');
    expect(hitTest(E1, [100, 60]).kind).toBe('wire');
    expect(hitTest(E1, [80, 60]).kind).toBe('probe');
    expect(hitTest(E1, [300, 300]).kind).toBe('empty');
  });
  it('lowest point of E1 is on the bottom rail', () => {
    expect(lowestPoint(E1)![1]).toBe(220);
  });
});
