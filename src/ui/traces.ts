/** Turn a solver result into one trace per probe (pure; tested in Node). */
import type { AcResult, TranResult } from '../engine';
import type { Circuit } from '../schematic/model';
import type { Extraction } from '../schematic/extract';
import { probeColor, probeLetter } from './state';

export interface Trace {
  id: string;
  label: string;
  color: string;
  unit: string;
  x: Float64Array;
  y: Float64Array;
  /** a "kept" ghost from a previous run: drawn dashed and lighter */
  kept?: boolean;
}

export function probeLabel(circuit: Circuit, id: string): string {
  const pr = circuit.probes.find((p) => p.id === id)!;
  const letter = probeLetter(circuit, id);
  if (pr.label) return pr.label;
  return pr.kind === 'v' ? `V${letter}` : pr.kind === 'i' ? `I${letter}` : `P${letter}`;
}

export function tracesFromTran(circuit: Circuit, ex: Extraction, r: TranResult): Trace[] {
  const out: Trace[] = [];
  for (const pr of circuit.probes) {
    const base = { id: pr.id, label: probeLabel(circuit, pr.id), color: probeColor(circuit, pr.id), x: r.t };
    if (pr.kind === 'v' && pr.nodeAt) {
      const n = ex.nodeAtPoint(pr.nodeAt);
      const ref = pr.refAt ? ex.nodeAtPoint(pr.refAt) : '0';
      if (n === undefined || ref === undefined || !r.v[n] || !r.v[ref]) continue;
      const y = new Float64Array(r.t.length);
      for (let k = 0; k < y.length; k++) y[k] = r.v[n][k] - r.v[ref][k];
      out.push({ ...base, unit: 'V', y });
    } else if (pr.element && r.i[pr.element]) {
      const el = ex.netlist.elements.find((e) => e.id === pr.element)!;
      const y = new Float64Array(r.t.length);
      if (pr.kind === 'i') {
        const d = pr.dir ?? 1;
        for (let k = 0; k < y.length; k++) y[k] = r.i[pr.element][k] * d;
        out.push({ ...base, unit: 'A', y });
      } else {
        const va = r.v[el.nodes[0]], vb = r.v[el.nodes[1]];
        for (let k = 0; k < y.length; k++) y[k] = (va[k] - vb[k]) * r.i[pr.element][k];
        out.push({ ...base, unit: 'W', y });
      }
    }
  }
  return out;
}

/** Complex traces for the frequency sweep (used by M3). */
export function tracesFromAc(circuit: Circuit, ex: Extraction, r: AcResult): { mag: Trace[]; phase: Trace[] } {
  const mag: Trace[] = [], phase: Trace[] = [];
  const push = (id: string, unit: string, re: Float64Array, im: Float64Array) => {
    const m = new Float64Array(r.f.length), p = new Float64Array(r.f.length);
    for (let k = 0; k < m.length; k++) { m[k] = Math.hypot(re[k], im[k]); p[k] = (Math.atan2(im[k], re[k]) * 180) / Math.PI; }
    unwrap(p);
    const base = { id, label: probeLabel(circuit, id), color: probeColor(circuit, id), x: r.f };
    mag.push({ ...base, unit, y: m });
    phase.push({ ...base, unit: '°', y: p });
  };
  for (const pr of circuit.probes) {
    if (pr.kind === 'v' && pr.nodeAt) {
      const n = ex.nodeAtPoint(pr.nodeAt);
      const ref = pr.refAt ? ex.nodeAtPoint(pr.refAt) : '0';
      if (n === undefined || ref === undefined || !r.v[n] || !r.v[ref]) continue;
      const re = new Float64Array(r.f.length), im = new Float64Array(r.f.length);
      for (let k = 0; k < re.length; k++) { re[k] = r.v[n].re[k] - r.v[ref].re[k]; im[k] = r.v[n].im[k] - r.v[ref].im[k]; }
      push(pr.id, 'V', re, im);
    } else if (pr.kind === 'i' && pr.element && r.i[pr.element]) {
      const d = pr.dir ?? 1;
      const re = new Float64Array(r.f.length), im = new Float64Array(r.f.length);
      for (let k = 0; k < re.length; k++) { re[k] = r.i[pr.element].re[k] * d; im[k] = r.i[pr.element].im[k] * d; }
      push(pr.id, 'A', re, im);
    }
  }
  return { mag, phase };
}

/** Unwrap phase in degrees along the sweep; anchor the first point to (-180, 180]. */
export function unwrap(p: Float64Array): void {
  for (let k = 1; k < p.length; k++) {
    let d = p[k] - p[k - 1];
    while (d > 180) { p[k] -= 360; d -= 360; }
    while (d <= -180) { p[k] += 360; d += 360; }
  }
}

/** Linear interpolation of a trace at x. */
export function valueAt(t: Trace, x: number): number {
  const xs = t.x, ys = t.y, n = xs.length;
  if (n === 0) return NaN;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
  const f = (x - xs[lo]) / (xs[hi] - xs[lo] || 1);
  return ys[lo] + f * (ys[hi] - ys[lo]);
}
