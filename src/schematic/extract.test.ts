/** Deliberately awkward layouts (SPEC §7.3). */
import { describe, it, expect } from 'vitest';
import { extract } from './extract';
import { pinPositions, type Circuit, type Part } from './model';

const base = (parts: Part[], wires: Circuit['wires'], labels: Circuit['labels'] = []): Circuit =>
  ({ v: 1, grid: 10, parts, wires, probes: [], analysis: { kind: 'dc' }, labels });

const R = (id: string, x: number, y: number, rot: Part['rot'] = 0): Part => ({ id, type: 'R', x, y, rot, params: { R: '1' } });

function nodesOf(c: Circuit, id: string): string[] {
  return extract(c).netlist.elements.find((e) => e.id === id)!.nodes;
}

describe('pin tables', () => {
  it('every pin lands on a grid point for all four rotations', () => {
    for (const type of ['R', 'C', 'Vdc', 'OPAMP', 'GND', 'CCCS'] as const) {
      for (const rot of [0, 90, 180, 270] as const) {
        for (const p of pinPositions({ id: 'x', type, x: 100, y: 100, rot })) {
          expect(p.x % 10).toBe(0);
          expect(p.y % 10).toBe(0);
        }
      }
    }
  });
  it('rotated 90/180/270 puts pins in the right place', () => {
    expect(pinPositions(R('r', 100, 100, 0)).map((p) => [p.x, p.y])).toEqual([[80, 100], [120, 100]]);
    expect(pinPositions(R('r', 100, 100, 90)).map((p) => [p.x, p.y])).toEqual([[100, 80], [100, 120]]);
    expect(pinPositions(R('r', 100, 100, 180)).map((p) => [p.x, p.y])).toEqual([[120, 100], [80, 100]]);
    expect(pinPositions(R('r', 100, 100, 270)).map((p) => [p.x, p.y])).toEqual([[100, 120], [100, 80]]);
  });
});

describe('extract', () => {
  it('two parts sharing a pin location with no wire are connected', () => {
    const c = base([R('R1', 100, 100), R('R2', 140, 100)], []);
    expect(nodesOf(c, 'R1')[1]).toBe(nodesOf(c, 'R2')[0]);
  });
  it('a wire passing over a pin without ending there does NOT connect', () => {
    const c = base([R('R1', 100, 100, 90)], [{ from: [60, 80], to: [140, 80] }]);
    const ex = extract(c);
    const r1 = ex.netlist.elements[0];
    expect(ex.nodeOfPoint.get('60,80')).not.toBe(r1.nodes[0]);
    expect(ex.diagnostics.some((d) => d.message.includes("R1 has a pin"))).toBe(true);
  });
  it('T-junction: a wire ending on the middle of another wire connects', () => {
    const c = base([R('R1', 40, 100, 90), R('R2', 200, 100, 90), R('R3', 120, 140, 90)],
      [{ from: [40, 80], to: [200, 80] }, { from: [120, 80], to: [120, 120] }]);
    expect(nodesOf(c, 'R3')[0]).toBe(nodesOf(c, 'R1')[0]);
    expect(nodesOf(c, 'R3')[0]).toBe(nodesOf(c, 'R2')[0]);
  });
  it('two collinear overlapping wires connect', () => {
    const c = base([R('R1', 20, 100, 90), R('R2', 220, 100, 90)],
      [{ from: [20, 80], to: [140, 80] }, { from: [100, 80], to: [220, 80] }]);
    expect(nodesOf(c, 'R1')[0]).toBe(nodesOf(c, 'R2')[0]);
  });
  it('two wires crossing without an endpoint do not connect', () => {
    const c = base([R('R1', 40, 100, 90), R('R2', 200, 100, 90), R('R3', 120, 40, 0), R('R4', 120, 160, 0)],
      [{ from: [40, 80], to: [200, 80] }, { from: [120, 60], to: [120, 140] }, { from: [100, 40], to: [100, 160] }, { from: [140, 40], to: [140, 160] }]);
    expect(nodesOf(c, 'R1')[0]).not.toBe(nodesOf(c, 'R3')[0]);
  });
  it('a label on the middle of a wire names that node', () => {
    const c = base([R('R1', 40, 100, 90), R('R2', 200, 100, 90)], [{ from: [40, 80], to: [200, 80] }], [{ at: [120, 80], text: 'top' }]);
    expect(nodesOf(c, 'R1')[0]).toBe('top');
    expect(extract(c).nodeAtPoint([90, 80])).toBe('top');
  });
  it('all ground symbols are node 0', () => {
    const c = base([R('R1', 100, 100), { id: 'G1', type: 'GND', x: 80, y: 100, rot: 0 }, { id: 'G2', type: 'GND', x: 120, y: 100, rot: 0 }], []);
    expect(nodesOf(c, 'R1')).toEqual(['0', '0']);
  });
  it('values are parsed and bad values reported', () => {
    const c = base([{ id: 'R1', type: 'R', x: 100, y: 100, rot: 0, params: { R: 'banana' } }, R('R2', 140, 100)], [{ from: [80, 100], to: [160, 100] }]);
    const ex = extract(c);
    expect(ex.diagnostics.some((d) => d.severity === 'error' && d.message.startsWith('R1:'))).toBe(true);
  });
});
