import { describe, it, expect } from 'vitest';
import { EXERCISES } from '../exercises';
import { extract, parseAnalysis } from '../schematic/extract';
import { run, type TranResult } from '../engine';
import { tracesFromTran, valueAt } from './traces';
import type { Circuit } from '../schematic/model';

function tran(id: string) {
  const file = EXERCISES.find((e) => e.exercise.id === id)!;
  const circuit = file as Circuit;
  const ex = extract(circuit);
  const r = run(ex.netlist, parseAnalysis(circuit.analysis)).result as TranResult;
  return { circuit, ex, r };
}

describe('traces from a Time run', () => {
  it('E4: the probe trace reads the book value at t = 0.1 s', () => {
    const { circuit, ex, r } = tran('E4');
    const traces = tracesFromTran(circuit, ex, r);
    expect(traces).toHaveLength(1);
    expect(traces[0].unit).toBe('V');
    expect(valueAt(traces[0], 0.1)).toBeCloseTo(12.365, 1);
  });
  it('E3: two traces, v_out = 2 v_in while the pulse is high', () => {
    const { circuit, ex, r } = tran('E3');
    const traces = tracesFromTran(circuit, ex, r);
    expect(traces.map((t) => t.label)).toEqual(['v_in', 'v_out']);
    expect(valueAt(traces[1], 0.002)).toBeCloseTo(2 * valueAt(traces[0], 0.002), 6);
  });
  it('E6: current probe on the inductor and a differential voltage probe', () => {
    const { circuit, ex, r } = tran('E6');
    const traces = tracesFromTran(circuit, ex, r);
    const iL = traces.find((t) => t.label === 'i_L')!;
    const vC = traces.find((t) => t.label === 'v_C')!;
    expect(iL.unit).toBe('A');
    expect(valueAt(iL, 0)).toBeCloseTo(0.03921, 4);
    expect(valueAt(vC, 0)).toBeCloseTo(-4.3135, 3);
  });
});
