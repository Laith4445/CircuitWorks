import { describe, it, expect } from 'vitest';
import { EXERCISES } from '../exercises';
import { extract, parseAnalysis } from '../schematic/extract';
import { run, type TranResult } from '../engine';
import { tracesFromTran, initialReadouts, averagePowers, valueAt } from './traces';
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
    expect(traces.map((t) => t.label).slice(0, 2)).toEqual(['v_in', 'v_out']);
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

describe('E6 initial-conditions table (before / just after / end)', () => {
  const { circuit, ex, r } = tran('E6');
  const rows = Object.fromEntries(initialReadouts(circuit, ex, r).map((x) => [x.label, x]));
  it('lists all five probes', () => {
    expect(Object.keys(rows).sort()).toEqual(['V_N', 'i_C', 'i_L', 'v_C', 'v_L']);
  });
  it('i_L is continuous: 39.21 mA before and just after, 5.949 mA at the end', () => {
    expect(rows.i_L.before).toBeCloseTo(0.03921, 4);
    expect(rows.i_L.after).toBeCloseTo(0.03921, 4);
    expect(rows.i_L.end).toBeCloseTo(0.005949, 5);
  });
  it('v_C is continuous: −4.3135 V before and after, −0.6544 V at the end', () => {
    expect(rows.v_C.before).toBeCloseTo(-4.3135, 3);
    expect(rows.v_C.after).toBeCloseTo(-4.3135, 3);
    expect(rows.v_C.end).toBeCloseTo(-0.6544, 3);
  });
  it('i_C and v_L jump: 0 before, 33.69 mA and −3.369 V just after', () => {
    expect(Math.abs(rows.i_C.before)).toBeLessThan(1e-9);
    expect(Math.abs(rows.v_L.before)).toBeLessThan(1e-9);
    expect(rows.i_C.after).toBeCloseTo(0.03369, 4);
    expect(rows.v_L.after).toBeCloseTo(-3.369, 2);
  });
  it('V(N) jumps from 0.3865 V to 3.7556 V and settles at 4.0456 V', () => {
    expect(rows.V_N.before).toBeCloseTo(0.3865, 3);
    expect(rows.V_N.after).toBeCloseTo(3.7556, 3);
    expect(rows.V_N.end).toBeCloseTo(4.0456, 3);
  });
});

describe('E7 time-domain wattmeter', () => {
  it('averages v·i over whole cycles and agrees with the AC value within 1 %', () => {
    const file = EXERCISES.find((e) => e.exercise.id === 'E7')!;
    const circuit: Circuit = { ...(file as Circuit), analysis: { kind: 'tran', tEnd: '20us' } };
    const ex = extract(circuit);
    const r = run(ex.netlist, parseAnalysis(circuit.analysis)).result as TranResult;
    const rows = averagePowers(circuit, tracesFromTran(circuit, ex, r));
    expect(rows).toHaveLength(1);
    expect(rows[0].cycles).toBe(10);
    expect(Math.abs(rows[0].average - 4.385e-7) / 4.385e-7).toBeLessThan(0.01);
  });
});
