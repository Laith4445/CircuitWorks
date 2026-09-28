/**
 * Runs an exercise file and compares the results with its stored reference
 * values. Used by both the unit tests and the Self-Check page, so there is one
 * source of truth (SPEC §7.2, §7.3).
 */
import { run, type AcResult, type DcResult, type TranResult, type Result } from '../engine';
import { extract, parseAnalysis } from '../schematic/extract';
import type { Circuit } from '../schematic/model';

export type Check =
  | { kind: 'dc_v'; node: string; ref?: string }
  | { kind: 'dc_i'; elem: string }
  | { kind: 'tran_v'; node: string; ref?: string; t: number; at?: '0-' }
  | { kind: 'tran_i'; elem: string; t: number; at?: '0-' }
  | { kind: 'tran_ev'; elem: string; t: number; at?: '0-' }
  | { kind: 'tran_peak'; node: string; ref?: string; what: 'value' | 'time' }
  | { kind: 'tran_overshoot'; node: string; ref?: string; above: number }   // expected 0 = none
  | { kind: 'tran_pavg'; node: string; ref?: string; elem: string; tFrom: number }
  | { kind: 'ac_mag'; node: string; div?: string; f: number }
  | { kind: 'ac_phase'; node: string; div?: string; f: number }
  | { kind: 'ac_i'; elem: string; f: number }
  | { kind: 'ac_cutoff'; node: string; div?: string; level: number; side: 'low' | 'high' }
  | { kind: 'ac_power'; node: string; ref?: string; elem: string; f: number; part: 'P' | 'Q' };

export interface CheckSpec {
  label: string;
  check: Check;
  expected: number;
  unit: string;
  tolPct?: number;
  tolAbs?: number;
}

export interface Variant {
  id: string;
  title: string;
  params?: Record<string, Record<string, string>>;   // partId -> {param: value}
  analysis?: Circuit['analysis'];
  checks: CheckSpec[];
}

export interface ExerciseFile extends Circuit {
  exercise: { id: string; title: string; problem: string; checks: CheckSpec[]; variants?: Variant[] };
}

export interface CheckRow {
  exercise: string;
  variant: string;
  label: string;
  expected: number;
  got: number | null;
  unit: string;
  errPct: number | null;
  tolerance: string;
  pass: boolean;
  error?: string;
}

export interface ExerciseReport {
  exercise: string;
  variant: string;
  title: string;
  analysis: string;
  ms: number;
  rows: CheckRow[];
  notes: string[];
  error?: string;
}

function applyVariant(file: ExerciseFile, v?: Variant): Circuit {
  const c: Circuit = JSON.parse(JSON.stringify({ ...file, exercise: undefined }));
  if (v?.params) {
    for (const p of c.parts) {
      const over = v.params[p.id];
      if (over) p.params = { ...(p.params ?? {}), ...over };
    }
  }
  if (v?.analysis) c.analysis = v.analysis;
  return c;
}

function interp(t: Float64Array, y: Float64Array, at: number): number {
  if (at <= t[0]) return y[0];
  const n = t.length;
  if (at >= t[n - 1]) return y[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (t[mid] <= at) lo = mid; else hi = mid; }
  const f = (at - t[lo]) / (t[hi] - t[lo]);
  return y[lo] + f * (y[hi] - y[lo]);
}

function diffTrace(r: TranResult, node: string, ref?: string): Float64Array {
  const a = r.v[node];
  if (!a) throw new Error(`no node "${node}" in the result`);
  if (!ref) return a;
  const b = r.v[ref];
  if (!b) throw new Error(`no node "${ref}" in the result`);
  const out = new Float64Array(a.length);
  for (let k = 0; k < a.length; k++) out[k] = a[k] - b[k];
  return out;
}

function acRatio(r: AcResult, node: string, div: string | undefined, p: number): { re: number; im: number } {
  const a = r.v[node];
  if (!a) throw new Error(`no node "${node}" in the result`);
  let re = a.re[p], im = a.im[p];
  if (div) {
    const b = r.v[div];
    if (!b) throw new Error(`no node "${div}" in the result`);
    const d = b.re[p] * b.re[p] + b.im[p] * b.im[p];
    const nre = (re * b.re[p] + im * b.im[p]) / d;
    const nim = (im * b.re[p] - re * b.im[p]) / d;
    re = nre; im = nim;
  }
  return { re, im };
}

function nearestIndex(f: Float64Array, target: number): number {
  let best = 0, bd = Infinity;
  for (let k = 0; k < f.length; k++) {
    const d = Math.abs(Math.log(f[k] / target));
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}

/** Evaluate one check against a result. Throws if the quantity can't be read. */
export function evaluate(check: Check, result: Result): number {
  switch (check.kind) {
    case 'dc_v': {
      const r = result as DcResult;
      return r.v[check.node] - (check.ref ? r.v[check.ref] : 0);
    }
    case 'dc_i': return (result as DcResult).i[check.elem];
    case 'tran_v': {
      const r = result as TranResult;
      if (check.at === '0-') return r.op0.v[check.node] - (check.ref ? r.op0.v[check.ref] : 0);
      return interp(r.t, diffTrace(r, check.node, check.ref), check.t);
    }
    case 'tran_i': {
      const r = result as TranResult;
      if (check.at === '0-') return r.op0.i[check.elem];
      return interp(r.t, r.i[check.elem], check.t);
    }
    case 'tran_ev': {
      const r = result as TranResult;
      const el = elementNodes(r, check.elem);
      if (check.at === '0-') return r.op0.v[el[0]] - r.op0.v[el[1]];
      return interp(r.t, diffTrace(r, el[0], el[1]), check.t);
    }
    case 'tran_peak': {
      const r = result as TranResult;
      const y = diffTrace(r, check.node, check.ref);
      let best = 0;
      for (let k = 1; k < y.length; k++) if (y[k] > y[best]) best = k;
      return check.what === 'value' ? y[best] : r.t[best];
    }
    case 'tran_overshoot': {
      const r = result as TranResult;
      const y = diffTrace(r, check.node, check.ref);
      let m = -Infinity;
      for (let k = 0; k < y.length; k++) m = Math.max(m, y[k]);
      return Math.max(0, m - check.above);
    }
    case 'tran_pavg': {
      const r = result as TranResult;
      const v = diffTrace(r, check.node, check.ref);
      const i = r.i[check.elem];
      let sum = 0, span = 0;
      for (let k = 1; k < r.t.length; k++) {
        if (r.t[k - 1] < check.tFrom) continue;
        const h = r.t[k] - r.t[k - 1];
        sum += 0.5 * (v[k] * i[k] + v[k - 1] * i[k - 1]) * h;
        span += h;
      }
      return sum / span;
    }
    case 'ac_mag': {
      const r = result as AcResult;
      const { re, im } = acRatio(r, check.node, check.div, nearestIndex(r.f, check.f));
      return Math.hypot(re, im);
    }
    case 'ac_phase': {
      const r = result as AcResult;
      const { re, im } = acRatio(r, check.node, check.div, nearestIndex(r.f, check.f));
      return (Math.atan2(im, re) * 180) / Math.PI;
    }
    case 'ac_i': {
      const r = result as AcResult;
      const p = nearestIndex(r.f, check.f);
      const tr = r.i[check.elem];
      if (!tr) throw new Error(`no element "${check.elem}" in the result`);
      return Math.hypot(tr.re[p], tr.im[p]);
    }
    case 'ac_cutoff': {
      const r = result as AcResult;
      const mags = new Float64Array(r.f.length);
      let peak = 0;
      for (let p = 0; p < r.f.length; p++) {
        const { re, im } = acRatio(r, check.node, check.div, p);
        mags[p] = Math.hypot(re, im);
        if (mags[p] > mags[peak]) peak = p;
      }
      // walk from the peak outward until the level is crossed; interpolate in log f
      if (check.side === 'low') {
        for (let p = peak; p > 0; p--) {
          if (mags[p - 1] < check.level && mags[p] >= check.level) {
            const fr = (check.level - mags[p - 1]) / (mags[p] - mags[p - 1]);
            return Math.exp(Math.log(r.f[p - 1]) + fr * (Math.log(r.f[p]) - Math.log(r.f[p - 1])));
          }
        }
      } else {
        for (let p = peak; p < r.f.length - 1; p++) {
          if (mags[p] >= check.level && mags[p + 1] < check.level) {
            const fr = (mags[p] - check.level) / (mags[p] - mags[p + 1]);
            return Math.exp(Math.log(r.f[p]) + fr * (Math.log(r.f[p + 1]) - Math.log(r.f[p])));
          }
        }
      }
      throw new Error('the response never crosses that level');
    }
    case 'ac_power': {
      const r = result as AcResult;
      const p = nearestIndex(r.f, check.f);
      const va = r.v[check.node], vb = check.ref ? r.v[check.ref] : undefined;
      const vre = va.re[p] - (vb ? vb.re[p] : 0), vim = va.im[p] - (vb ? vb.im[p] : 0);
      const ire = r.i[check.elem].re[p], iim = r.i[check.elem].im[p];
      // S = 1/2 V I*
      const P = 0.5 * (vre * ire + vim * iim);
      const Q = 0.5 * (vim * ire - vre * iim);
      return check.part === 'P' ? P : Q;
    }
  }
}

const elementNodeCache = new WeakMap<object, Map<string, string[]>>();
function elementNodes(r: TranResult, id: string): string[] {
  const m = elementNodeCache.get(r)?.get(id);
  if (!m) throw new Error(`no element "${id}" in the result`);
  return m;
}

function withinTolerance(spec: CheckSpec, got: number): { pass: boolean; errPct: number | null; tolerance: string } {
  const abs = Math.abs(got - spec.expected);
  if (spec.tolAbs !== undefined) {
    return { pass: abs <= spec.tolAbs, errPct: spec.expected !== 0 ? (100 * (got - spec.expected)) / Math.abs(spec.expected) : null, tolerance: `±${spec.tolAbs} ${spec.unit}` };
  }
  const pct = spec.tolPct ?? 1;
  const errPct = spec.expected !== 0 ? (100 * (got - spec.expected)) / Math.abs(spec.expected) : null;
  const pass = spec.expected !== 0 ? Math.abs(errPct!) <= pct : abs <= 1e-9;
  return { pass, errPct, tolerance: `±${pct} %` };
}

export function runExercise(file: ExerciseFile): ExerciseReport[] {
  const reports: ExerciseReport[] = [];
  const variants: (Variant | undefined)[] = [undefined, ...(file.exercise.variants ?? [])];
  for (const variant of variants) {
    const circuit = applyVariant(file, variant);
    const vid = variant?.id ?? '';
    const title = variant?.title ?? file.exercise.title;
    const checks = variant?.checks ?? file.exercise.checks;
    const report: ExerciseReport = { exercise: file.exercise.id, variant: vid, title, analysis: circuit.analysis.kind, ms: 0, rows: [], notes: [] };
    reports.push(report);
    try {
      const ex = extract(circuit);
      const errs = ex.diagnostics.filter((d) => d.severity === 'error');
      if (errs.length) throw new Error(errs.map((d) => d.message).join(' '));
      const spec = parseAnalysis(circuit.analysis);
      const t0 = performance.now();
      const out = run(ex.netlist, spec);
      report.ms = performance.now() - t0;
      report.notes = [...out.diagnostics.map((d) => d.message), ...out.result.notes];
      const nodeMap = new Map<string, string[]>();
      for (const e of ex.netlist.elements) nodeMap.set(e.id, e.nodes);
      elementNodeCache.set(out.result, nodeMap);
      for (const c of checks) {
        const row: CheckRow = { exercise: file.exercise.id, variant: vid, label: c.label, expected: c.expected, got: null, unit: c.unit, errPct: null, tolerance: '', pass: false };
        try {
          const got = evaluate(c.check, out.result);
          const tol = withinTolerance(c, got);
          Object.assign(row, { got, ...tol });
        } catch (e) {
          row.error = (e as Error).message;
        }
        report.rows.push(row);
      }
    } catch (e) {
      report.error = (e as Error).message;
      for (const c of checks) report.rows.push({ exercise: file.exercise.id, variant: vid, label: c.label, expected: c.expected, got: null, unit: c.unit, errPct: null, tolerance: '', pass: false, error: report.error });
    }
  }
  return reports;
}
