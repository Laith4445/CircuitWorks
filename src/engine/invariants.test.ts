/**
 * Physics sanity checks that must hold for every solution regardless of the
 * reference values: Kirchhoff's current law at every node, power balance
 * (sources deliver exactly what the rest absorbs), and energy conservation
 * for the E4 transient.
 */
import { describe, it, expect } from 'vitest';
import { EXERCISES } from '../exercises';
import { extract, parseAnalysis } from '../schematic/extract';
import { run, GROUND, type AcResult, type DcResult, type Netlist, type TranResult } from './index';

const GMIN = 1e-12;

function load(id: string) {
  const file = EXERCISES.find((e) => e.exercise.id === id)!;
  const ex = extract(file);
  return { nl: ex.netlist, spec: parseAnalysis(file.analysis) };
}

/** Sum of currents leaving each node into elements (plus the gmin leak). */
function kclResidualsDc(nl: Netlist, v: Record<string, number>, i: Record<string, number>): { worst: number; scale: number } {
  let worst = 0, scale = 0;
  for (const n of nl.nodes) {
    if (n === GROUND) continue;
    let sum = v[n] * GMIN;
    for (const e of nl.elements) {
      if (e.type === 'OPAMP') { if (e.nodes[2] === n) sum -= i[e.id]; continue; }
      if (e.nodes[0] === n) sum += i[e.id];
      if (e.nodes[1] === n) sum -= i[e.id];
      scale = Math.max(scale, Math.abs(i[e.id]));
    }
    worst = Math.max(worst, Math.abs(sum));
  }
  return { worst, scale };
}

function powerBalanceDc(nl: Netlist, r: DcResult): { total: number; scale: number } {
  let total = 0, scale = 0;
  for (const e of nl.elements) {
    let p: number;
    if (e.type === 'OPAMP') p = -r.v[e.nodes[2]] * r.i[e.id];
    else p = (r.v[e.nodes[0]] - r.v[e.nodes[1]]) * r.i[e.id];
    total += p;
    scale = Math.max(scale, Math.abs(p));
  }
  for (const n of nl.nodes) if (n !== GROUND) total += r.v[n] * r.v[n] * GMIN;
  return { total, scale };
}

describe('KCL and power balance, DC', () => {
  for (const id of ['E1', 'E2']) {
    it(`${id}: currents sum to zero at every node`, () => {
      const { nl, spec } = load(id);
      const r = run(nl, spec).result as DcResult;
      const { worst, scale } = kclResidualsDc(nl, r.v, r.i);
      expect(worst).toBeLessThan(1e-9 * scale + 1e-15);
    });
    it(`${id}: source power equals absorbed power`, () => {
      const { nl, spec } = load(id);
      const r = run(nl, spec).result as DcResult;
      const { total, scale } = powerBalanceDc(nl, r);
      expect(Math.abs(total)).toBeLessThan(1e-9 * scale + 1e-15);
    });
  }
  it('E6 pre-switch operating point obeys KCL and power balance', () => {
    const { nl, spec } = load('E6');
    const r = run(nl, spec).result as TranResult;
    const { worst, scale } = kclResidualsDc(nl, r.op0.v, r.op0.i);
    expect(worst).toBeLessThan(1e-9 * scale + 1e-15);
    const pb = powerBalanceDc(nl, r.op0);
    expect(Math.abs(pb.total)).toBeLessThan(1e-9 * pb.scale + 1e-15);
  });
});

describe('KCL and power balance, AC (every frequency)', () => {
  for (const id of ['E5', 'E7']) {
    it(`${id}: complex currents sum to zero at every node and complex power balances`, () => {
      const { nl, spec } = load(id);
      const r = run(nl, spec).result as AcResult;
      for (let p = 0; p < r.f.length; p++) {
        let scaleI = 0;
        for (const n of nl.nodes) {
          if (n === GROUND) continue;
          let sre = r.v[n].re[p] * 1e-15, sim = r.v[n].im[p] * 1e-15;
          for (const e of nl.elements) {
            const s = e.type === 'OPAMP' ? (e.nodes[2] === n ? -1 : 0) : (e.nodes[0] === n ? 1 : 0) - (e.nodes[1] === n ? 1 : 0);
            sre += s * r.i[e.id].re[p]; sim += s * r.i[e.id].im[p];
            scaleI = Math.max(scaleI, Math.hypot(r.i[e.id].re[p], r.i[e.id].im[p]));
          }
          expect(Math.hypot(sre, sim)).toBeLessThan(1e-9 * scaleI + 1e-18);
        }
        // S = 1/2 V I*  summed over elements = 0
        let Pre = 0, Pim = 0, scaleP = 0;
        for (const e of nl.elements) {
          const a = e.type === 'OPAMP' ? e.nodes[2] : e.nodes[0];
          const b = e.type === 'OPAMP' ? GROUND : e.nodes[1];
          const sign = e.type === 'OPAMP' ? -1 : 1;
          const vre = r.v[a].re[p] - r.v[b].re[p], vim = r.v[a].im[p] - r.v[b].im[p];
          const ire = sign * r.i[e.id].re[p], iim = sign * r.i[e.id].im[p];
          const sre = 0.5 * (vre * ire + vim * iim), sim = 0.5 * (vim * ire - vre * iim);
          Pre += sre; Pim += sim; scaleP = Math.max(scaleP, Math.hypot(sre, sim));
        }
        expect(Math.hypot(Pre, Pim)).toBeLessThan(1e-9 * scaleP + 1e-18);
      }
    });
  }
});

describe('KCL, transient (every time step)', () => {
  for (const id of ['E3', 'E4', 'E6']) {
    it(`${id}: currents sum to zero at every node at every step`, () => {
      const { nl, spec } = load(id);
      const r = run(nl, spec).result as TranResult;
      let worst = 0, scale = 0;
      for (let k = 0; k < r.t.length; k++) {
        for (const n of nl.nodes) {
          if (n === GROUND) continue;
          let sum = r.v[n][k] * GMIN;
          for (const e of nl.elements) {
            if (e.type === 'OPAMP') { if (e.nodes[2] === n) sum -= r.i[e.id][k]; continue; }
            if (e.nodes[0] === n) sum += r.i[e.id][k];
            if (e.nodes[1] === n) sum -= r.i[e.id][k];
            scale = Math.max(scale, Math.abs(r.i[e.id][k]));
          }
          worst = Math.max(worst, Math.abs(sum));
        }
      }
      expect(worst).toBeLessThan(1e-9 * scale + 1e-15);
    });
  }
});

describe('energy check, E4 transient', () => {
  it('energy delivered by the source = energy dissipated in R + energy stored in L and C (within 1 %)', () => {
    const { nl, spec } = load('E4');
    const r = run(nl, spec).result as TranResult;
    const R = nl.elements.find((e) => e.id === 'R1')!.values.R;
    const L = nl.elements.find((e) => e.id === 'L1')!.values.L;
    const C = nl.elements.find((e) => e.id === 'C1')!.values.C;
    const N = r.t.length;
    let delivered = 0, dissipated = 0;
    for (let k = 1; k < N; k++) {
      const h = r.t[k] - r.t[k - 1];
      const pS = (t: number) => -(r.v['a'][t] - r.v['0'][t]) * r.i['V1'][t];
      const pR = (t: number) => r.i['R1'][t] * r.i['R1'][t] * R;
      delivered += 0.5 * (pS(k) + pS(k - 1)) * h;
      dissipated += 0.5 * (pR(k) + pR(k - 1)) * h;
    }
    const vC = r.v['c'][N - 1];
    const iL = r.i['L1'][N - 1];
    const stored = 0.5 * C * vC * vC + 0.5 * L * iL * iL;
    expect(Math.abs(delivered - dissipated - stored) / delivered).toBeLessThan(0.01);
  });
});
