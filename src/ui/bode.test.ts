import { describe, it, expect } from 'vitest';
import { EXERCISES } from '../exercises';
import { extract, parseAnalysis } from '../schematic/extract';
import { run, type AcResult } from '../engine';
import { tracesFromAc, toDb, valueAt } from './traces';
import type { Circuit } from '../schematic/model';

function sweep(id: string) {
  const circuit = EXERCISES.find((e) => e.exercise.id === id)! as Circuit;
  const ex = extract(circuit);
  const r = run(ex.netlist, parseAnalysis(circuit.analysis)).result as AcResult;
  return { circuit, ex, r };
}

/** What a student does with the cursor: walk the trace to the first crossing of a level. */
function crossing(t: { x: Float64Array; y: Float64Array }, level: number, from: 'low' | 'high'): number {
  const n = t.x.length;
  if (from === 'low') {
    for (let k = 1; k < n; k++) if (t.y[k - 1] < level && t.y[k] >= level) {
      const f = (level - t.y[k - 1]) / (t.y[k] - t.y[k - 1]);
      return Math.exp(Math.log(t.x[k - 1]) + f * (Math.log(t.x[k]) - Math.log(t.x[k - 1])));
    }
  } else {
    for (let k = n - 1; k > 0; k--) if (t.y[k] < level && t.y[k - 1] >= level) {
      const f = (t.y[k - 1] - level) / (t.y[k - 1] - t.y[k]);
      return Math.exp(Math.log(t.x[k - 1]) + f * (Math.log(t.x[k]) - Math.log(t.x[k - 1])));
    }
  }
  return NaN;
}

describe('E5 Bode traces', () => {
  const { circuit, ex, r } = sweep('E5');
  const { mag, phase } = tracesFromAc(circuit, ex, r);
  const H = mag.find((t) => t.label === 'H')!;
  const Hp = phase.find((t) => t.label === 'H')!;
  it('has a ratio trace H = v_out / v_in that is unitless', () => {
    expect(H).toBeDefined();
    expect(H.unit).toBe('');
  });
  it('|H| = 1 (0 dB) and phase 0° at 1 MHz', () => {
    expect(valueAt(H, 1e6)).toBeCloseTo(1, 3);
    expect(valueAt(toDb(H), 1e6)).toBeCloseTo(0, 1);
    expect(Math.abs(valueAt(Hp, 1e6))).toBeLessThan(0.1);
  });
  it('phase runs continuously from +89.4° to −89.4° with no 360° jump', () => {
    expect(valueAt(Hp, 1e5)).toBeCloseTo(89.4, 0);
    expect(valueAt(Hp, 1e7)).toBeCloseTo(-89.4, 0);
    for (let k = 1; k < Hp.y.length; k++) expect(Math.abs(Hp.y[k] - Hp.y[k - 1])).toBeLessThan(90);
  });
  it('the cursor can find the half-power frequencies within 0.5 %', () => {
    const lo = crossing(H, Math.SQRT1_2, 'low');
    const hi = crossing(H, Math.SQRT1_2, 'high');
    expect(Math.abs(lo - 951200) / 951200).toBeLessThan(0.005);
    expect(Math.abs(hi - 1051200) / 1051200).toBeLessThan(0.005);
  });
});
