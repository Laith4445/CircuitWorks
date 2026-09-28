/** Turn a solver result into one trace per probe (pure; tested in Node). */
import type { AcResult, DcResult, TranResult } from '../engine';
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
  /** which panel of a multi-panel plot this belongs to */
  panel?: 'mag' | 'phase';
}

export function probeLabel(circuit: Circuit, id: string): string {
  const pr = circuit.probes.find((p) => p.id === id)!;
  const letter = probeLetter(circuit, id);
  if (pr.label) return pr.label;
  if (pr.kind === 'ratio') return `${probeLabel(circuit, pr.num ?? '')}/${probeLabel(circuit, pr.den ?? '')}`;
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

/** Complex traces for the frequency sweep: magnitude (linear) and unwrapped phase per probe. */
export function tracesFromAc(circuit: Circuit, ex: Extraction, r: AcResult): { mag: Trace[]; phase: Trace[] } {
  const mag: Trace[] = [], phase: Trace[] = [];
  const complex = new Map<string, { re: Float64Array; im: Float64Array; unit: string }>();
  for (const pr of circuit.probes) {
    if (pr.kind === 'v' && pr.nodeAt) {
      const n = ex.nodeAtPoint(pr.nodeAt);
      const ref = pr.refAt ? ex.nodeAtPoint(pr.refAt) : '0';
      if (n === undefined || ref === undefined || !r.v[n] || !r.v[ref]) continue;
      const re = new Float64Array(r.f.length), im = new Float64Array(r.f.length);
      for (let k = 0; k < re.length; k++) { re[k] = r.v[n].re[k] - r.v[ref].re[k]; im[k] = r.v[n].im[k] - r.v[ref].im[k]; }
      complex.set(pr.id, { re, im, unit: 'V' });
    } else if (pr.kind === 'i' && pr.element && r.i[pr.element]) {
      const d = pr.dir ?? 1;
      const re = new Float64Array(r.f.length), im = new Float64Array(r.f.length);
      for (let k = 0; k < re.length; k++) { re[k] = r.i[pr.element].re[k] * d; im[k] = r.i[pr.element].im[k] * d; }
      complex.set(pr.id, { re, im, unit: 'A' });
    }
  }
  for (const pr of circuit.probes) {
    if (pr.kind !== 'ratio' || !pr.num || !pr.den) continue;
    const a = complex.get(pr.num), b = complex.get(pr.den);
    if (!a || !b) continue;
    const re = new Float64Array(r.f.length), im = new Float64Array(r.f.length);
    for (let k = 0; k < re.length; k++) {
      const d = b.re[k] * b.re[k] + b.im[k] * b.im[k] || 1e-300;
      re[k] = (a.re[k] * b.re[k] + a.im[k] * b.im[k]) / d;
      im[k] = (a.im[k] * b.re[k] - a.re[k] * b.im[k]) / d;
    }
    complex.set(pr.id, { re, im, unit: a.unit === b.unit ? '' : `${a.unit}/${b.unit}` });
  }
  for (const pr of circuit.probes) {
    const c = complex.get(pr.id);
    if (!c) continue;
    const m = new Float64Array(r.f.length), p = new Float64Array(r.f.length);
    for (let k = 0; k < m.length; k++) { m[k] = Math.hypot(c.re[k], c.im[k]); p[k] = (Math.atan2(c.im[k], c.re[k]) * 180) / Math.PI; }
    unwrap(p);
    const base = { id: pr.id, label: probeLabel(circuit, pr.id), color: probeColor(circuit, pr.id), x: r.f };
    mag.push({ ...base, unit: c.unit, y: m, panel: 'mag' });
    phase.push({ ...base, unit: '°', y: p, panel: 'phase' });
  }
  return { mag, phase };
}

/** Magnitude trace in dB (20·log10). Zero magnitudes become -300 dB so the axis stays finite. */
export function toDb(t: Trace): Trace {
  const y = new Float64Array(t.y.length);
  for (let k = 0; k < y.length; k++) y[k] = t.y[k] > 0 ? 20 * Math.log10(t.y[k]) : -300;
  return { ...t, y, unit: 'dB' };
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

/** Value of a probe from a DC (operating-point) result, with the unit. */
export function probeValueDc(circuit: Circuit, ex: Extraction, dc: DcResult, id: string): { value: number; unit: string } | null {
  const pr = circuit.probes.find((p) => p.id === id);
  if (!pr) return null;
  if (pr.kind === 'v' && pr.nodeAt) {
    const n = ex.nodeAtPoint(pr.nodeAt);
    const ref = pr.refAt ? ex.nodeAtPoint(pr.refAt) : '0';
    if (n === undefined || ref === undefined || dc.v[n] === undefined || dc.v[ref] === undefined) return null;
    return { value: dc.v[n] - dc.v[ref], unit: 'V' };
  }
  if ((pr.kind === 'i' || pr.kind === 'p') && pr.element && dc.i[pr.element] !== undefined) {
    const el = ex.netlist.elements.find((e) => e.id === pr.element)!;
    const i = dc.i[pr.element];
    if (pr.kind === 'i') return { value: i * (pr.dir ?? 1), unit: 'A' };
    return { value: (dc.v[el.nodes[0]] - dc.v[el.nodes[1]]) * i, unit: 'W' };
  }
  return null;
}

export interface InitialReadout { id: string; label: string; color: string; unit: string; before: number; after: number; end: number }

/**
 * The "initial conditions" table for a Time run: each probe just before t = 0
 * (switches in their starting state), just after (switches flipped, capacitor
 * voltages and inductor currents carried over), and at the end of the run.
 */
export function initialReadouts(circuit: Circuit, ex: Extraction, r: TranResult): InitialReadout[] {
  const out: InitialReadout[] = [];
  const traces = tracesFromTran(circuit, ex, r);
  for (const t of traces) {
    const before = probeValueDc(circuit, ex, r.op0, t.id);
    if (!before) continue;
    let scale = Math.abs(before.value);
    for (let k = 0; k < t.y.length; k++) scale = Math.max(scale, Math.abs(t.y[k]));
    out.push({ id: t.id, label: t.label, color: t.color, unit: t.unit, before: cleanTiny(before.value, scale), after: cleanTiny(t.y[0], scale), end: cleanTiny(t.y[t.y.length - 1], scale) });
  }
  return out;
}

/** Numbers that are only floating-point noise next to their companions read as 0 (SPEC §9.12). */
export function cleanTiny(v: number, scale: number): number {
  return Math.abs(v) < scale * 1e-9 ? 0 : v;
}
