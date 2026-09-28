import { describe, it, expect } from 'vitest';
import { diagnose, hasErrors } from './diagnose';
import type { Element, Netlist } from './netlist';
import { run, DiagnosticError } from './index';

const el = (id: string, type: Element['type'], nodes: string[], values: Record<string, number> = {}, opts: Record<string, string> = {}): Element =>
  ({ id, type, nodes, values, opts });

const nl = (...elements: Element[]): Netlist => {
  const nodes = new Set<string>(['0']);
  for (const e of elements) for (const n of e.nodes) nodes.add(n);
  return { elements, nodes: [...nodes] };
};

describe('diagnose', () => {
  it('a good divider has no errors', () => {
    const d = diagnose(nl(el('V1', 'Vdc', ['a', '0'], { V: 5 }), el('R1', 'R', ['a', 'b'], { R: 1 }), el('R2', 'R', ['b', '0'], { R: 1 })));
    expect(hasErrors(d)).toBe(false);
  });
  it('missing ground', () => {
    const d = diagnose(nl(el('V1', 'Vdc', ['a', 'b'], { V: 5 }), el('R1', 'R', ['a', 'b'], { R: 1 })));
    expect(d.map((x) => x.message)).toContain('Add a ground so voltages have a reference.');
  });
  it('unconnected pin', () => {
    const d = diagnose(nl(el('V1', 'Vdc', ['a', '0'], { V: 5 }), el('R1', 'R', ['a', 'b'], { R: 1 }), el('R3', 'R', ['b', 'c'], { R: 1 }), el('R2', 'R', ['b', '0'], { R: 1 })));
    expect(d.some((x) => x.message === "R3 has a pin that isn't wired to anything." && x.severity === 'error')).toBe(true);
  });
  it('two voltage sources in parallel', () => {
    const d = diagnose(nl(el('V1', 'Vdc', ['a', '0'], { V: 5 }), el('V2', 'Vdc', ['a', '0'], { V: 3 }), el('R1', 'R', ['a', '0'], { R: 1 })));
    const m = d.find((x) => x.severity === 'error')!;
    expect(m.message).toMatch(/V2 and V1 are wired directly in parallel/);
    expect(m.ids).toEqual(['V2', 'V1']);
  });
  it('op amp output shorted to ground', () => {
    const d = diagnose(nl(el('V1', 'Vdc', ['in', '0'], { V: 1 }), el('OA1', 'OPAMP', ['in', '0', '0']), el('R1', 'R', ['in', '0'], { R: 1 })));
    expect(d.some((x) => x.severity === 'error' && x.ids.includes('OA1'))).toBe(true);
  });
  it('current source with nowhere to go', () => {
    const d = diagnose(nl(el('I1', 'Idc', ['0', 'a'], { I: 1 }), el('R1', 'R', ['a', 'b'], { R: 1 }), el('R2', 'R', ['b', '0'], { R: 1 }), el('I2', 'Idc', ['c', '0'], { I: 1 }), el('R3', 'R', ['c', 'd'], { R: 1 }), el('R4', 'R', ['d', 'e'], { R: 1 }), el('R5', 'R', ['e', 'f'], { R: 1 })));
    expect(d.some((x) => x.message === "I1's current has nowhere to go.")).toBe(false);
    expect(d.some((x) => x.message.includes("R5 has a pin"))).toBe(true);
  });
  it('node only reachable through capacitors gets a note, not an error', () => {
    const d = diagnose(nl(el('V1', 'Vdc', ['a', '0'], { V: 5 }), el('C1', 'C', ['a', 'b'], { C: 1e-6 }), el('C2', 'C', ['b', '0'], { C: 1e-6 })));
    expect(hasErrors(d)).toBe(false);
    expect(d.some((x) => x.severity === 'note' && /no DC path to ground/.test(x.message))).toBe(true);
  });
  it('controlled source whose control element was deleted', () => {
    const d = diagnose(nl(el('V1', 'Vdc', ['a', '0'], { V: 5 }), el('R1', 'R', ['a', 'b'], { R: 1 }), el('F1', 'CCCS', ['b', '0'], { gain: 2 }, { ctrl: 'R9' }), el('R2', 'R', ['b', '0'], { R: 1 })));
    expect(d.some((x) => x.message === 'F1 was controlled by R9, which no longer exists.')).toBe(true);
  });
  it('run() refuses to solve a circuit with errors', () => {
    expect(() => run(nl(el('V1', 'Vdc', ['a', 'b'], { V: 5 }), el('R1', 'R', ['a', 'b'], { R: 1 })), { kind: 'dc' })).toThrow(DiagnosticError);
  });
  it('a floating capacitor node still solves in DC (gmin) without crashing', () => {
    const r = run(nl(el('V1', 'Vdc', ['a', '0'], { V: 5 }), el('R1', 'R', ['a', 'b'], { R: 1 }), el('C1', 'C', ['b', 'c'], { C: 1e-6 }), el('R2', 'R', ['c', '0'], { R: 1 })), { kind: 'dc' });
    expect(r.result.kind).toBe('dc');
    expect((r.result as { v: Record<string, number> }).v['b']).toBeCloseTo(5, 6);
  });
});
