/**
 * Grading for "try it yourself" mode. The student draws the circuit from the
 * problem text and places their own probes; each reference value from the
 * exercise file becomes a target, and a target passes when one of the
 * student's probes reads it within tolerance. Node names and part ids in the
 * student's drawing don't matter — only what the probes measure.
 */
import { run, DiagnosticError, SolverError, type AcResult, type DcResult, type TranResult } from '../engine';
import { extract, parseAnalysis } from '../schematic/extract';
import type { Circuit } from '../schematic/model';
import { formatSI } from '../engine/units';
import { tracesFromTran, tracesFromAc, probeValueDc, valueAt, type Trace } from '../ui/traces';
import type { Check, CheckSpec, ExerciseFile } from './check';

export interface Target {
  label: string;
  expected: number;
  unit: string;
  tolPct?: number;
  tolAbs?: number;
  /** what the student's probe must be: voltage, current, power, ratio (transfer function) */
  needs: 'v' | 'i' | 'p' | 'ratio';
  /** how to read the student's probe */
  how: { kind: 'dc' } | { kind: 'tran'; t: number; at?: '0-' } | { kind: 'peak'; what: 'value' | 'time' } | { kind: 'overshoot'; above: number }
    | { kind: 'ac'; f: number; part: 'mag' | 'phase' | 'P' | 'Q' } | { kind: 'cutoff'; level: number; side: 'low' | 'high' };
}

function targetOf(c: CheckSpec): Target | null {
  const base = { label: c.label, expected: c.expected, unit: c.unit, tolPct: c.tolPct, tolAbs: c.tolAbs };
  const k: Check = c.check;
  switch (k.kind) {
    case 'dc_v': return { ...base, needs: 'v', how: { kind: 'dc' } };
    case 'dc_i': return { ...base, needs: 'i', how: { kind: 'dc' } };
    case 'tran_v': case 'tran_ev': return { ...base, needs: 'v', how: { kind: 'tran', t: k.t, at: k.at } };
    case 'tran_i': return { ...base, needs: 'i', how: { kind: 'tran', t: k.t, at: k.at } };
    case 'tran_peak': return { ...base, needs: 'v', how: { kind: 'peak', what: k.what } };
    case 'tran_overshoot': return { ...base, needs: 'v', how: { kind: 'overshoot', above: k.above } };
    case 'tran_pavg': return null;
    case 'ac_mag': return { ...base, needs: k.div ? 'ratio' : 'v', how: { kind: 'ac', f: k.f, part: 'mag' } };
    case 'ac_phase': return { ...base, needs: k.div ? 'ratio' : 'v', how: { kind: 'ac', f: k.f, part: 'phase' } };
    case 'ac_i': return { ...base, needs: 'i', how: { kind: 'ac', f: k.f, part: 'mag' } };
    case 'ac_cutoff': return { ...base, needs: k.div ? 'ratio' : 'v', how: { kind: 'cutoff', level: k.level, side: k.side } };
    case 'ac_power': return { ...base, needs: 'p', how: { kind: 'ac', f: k.f, part: k.part } };
  }
}

export function targetsFor(file: ExerciseFile): Target[] {
  return file.exercise.checks.map(targetOf).filter((t): t is Target => t !== null);
}

export interface GradeRow { label: string; expected: number; unit: string; got: number | null; probe: string | null; pass: boolean; hint: string }
export interface GradeResult { rows: GradeRow[]; passed: number; total: number; error?: string }

function within(t: Target, got: number): boolean {
  if (t.tolAbs !== undefined) return Math.abs(got - t.expected) <= t.tolAbs;
  const pct = t.tolPct ?? 1;
  if (t.expected === 0) return Math.abs(got) <= 1e-9;
  return Math.abs((got - t.expected) / t.expected) * 100 <= pct;
}

function crossing(t: Trace, level: number, side: 'low' | 'high'): number | null {
  const n = t.x.length;
  let peak = 0;
  for (let k = 1; k < n; k++) if (t.y[k] > t.y[peak]) peak = k;
  if (side === 'low') {
    for (let k = peak; k > 0; k--) if (t.y[k - 1] < level && t.y[k] >= level) {
      const f = (level - t.y[k - 1]) / (t.y[k] - t.y[k - 1]);
      return Math.exp(Math.log(t.x[k - 1]) + f * (Math.log(t.x[k]) - Math.log(t.x[k - 1])));
    }
  } else {
    for (let k = peak; k < n - 1; k++) if (t.y[k] >= level && t.y[k + 1] < level) {
      const f = (t.y[k] - level) / (t.y[k] - t.y[k + 1]);
      return Math.exp(Math.log(t.x[k]) + f * (Math.log(t.x[k + 1]) - Math.log(t.x[k])));
    }
  }
  return null;
}

const NEEDS_TEXT: Record<Target['needs'], string> = {
  v: 'a voltage probe (P) on the right point — drag its ○ to measure between two points',
  i: 'a current probe on the right part (check the arrow direction)',
  p: 'a power probe on the load (make it a wattmeter if the voltage is across more than one part)',
  ratio: 'two voltage probes, then shift-click both and press Ratio',
};

/** Grade the student's circuit against the exercise. Uses the exercise's own analysis settings. */
export function grade(file: ExerciseFile, student: Circuit): GradeResult {
  const targets = targetsFor(file);
  const empty = (error: string): GradeResult => ({ rows: targets.map((t) => ({ label: t.label, expected: t.expected, unit: t.unit, got: null, probe: null, pass: false, hint: '' })), passed: 0, total: targets.length, error });
  if (!student.parts.length) return empty('The drawing is empty. Build the circuit from the problem text, add probes, then press Check.');
  const ex = extract(student);
  const errs = ex.diagnostics.filter((d) => d.severity === 'error');
  if (errs.length) return empty(errs[0].message);
  let out;
  try { out = run(ex.netlist, parseAnalysis(file.analysis)); }
  catch (e) {
    if (e instanceof DiagnosticError) return empty(e.diagnostics.filter((d) => d.severity === 'error')[0]?.message ?? e.message);
    if (e instanceof SolverError) return empty(e.message);
    return empty((e as Error).message);
  }
  const r = out.result;

  // candidate readings per probe: { probe id, needs, value }
  type Reading = { probe: string; needs: Target['needs']; value: number };
  const readingsFor = (t: Target): Reading[] => {
    const list: Reading[] = [];
    const probeNeeds = (id: string): Target['needs'] | null => {
      const pr = student.probes.find((p) => p.id === id);
      return pr ? (pr.kind === 'ratio' ? 'ratio' : pr.kind) : null;
    };
    if (r.kind === 'dc' && t.how.kind === 'dc') {
      for (const pr of student.probes) {
        const v = probeValueDc(student, ex, r as DcResult, pr.id);
        if (v && pr.kind === t.needs) list.push({ probe: pr.id, needs: pr.kind as Target['needs'], value: v.value });
      }
    } else if (r.kind === 'tran') {
      const tr = r as TranResult;
      const traces = tracesFromTran(student, ex, tr);
      for (const trace of traces) {
        const needs = probeNeeds(trace.id);
        if (needs !== t.needs) continue;
        let value: number | null = null;
        if (t.how.kind === 'tran') {
          if (t.how.at === '0-') { const v = probeValueDc(student, ex, tr.op0, trace.id); value = v ? v.value : null; }
          else value = valueAt(trace, t.how.t);
        } else if (t.how.kind === 'peak') {
          let best = 0;
          for (let k = 1; k < trace.y.length; k++) if (trace.y[k] > trace.y[best]) best = k;
          value = t.how.what === 'value' ? trace.y[best] : trace.x[best];
        } else if (t.how.kind === 'overshoot') {
          let m = -Infinity;
          for (let k = 0; k < trace.y.length; k++) m = Math.max(m, trace.y[k]);
          value = Math.max(0, m - t.how.above);
        }
        if (value !== null) list.push({ probe: trace.id, needs, value });
      }
    } else if (r.kind === 'ac') {
      const { mag, phase, power, reactive } = tracesFromAc(student, ex, r as AcResult);
      const pick = (arr: Trace[]) => arr.filter((x) => probeNeeds(x.id) === t.needs);
      if (t.how.kind === 'ac') {
        const h = t.how;
        const src = h.part === 'mag' ? pick(mag) : h.part === 'phase' ? pick(phase) : h.part === 'P' ? pick(power) : pick(reactive);
        for (const trace of src) list.push({ probe: trace.id, needs: t.needs, value: valueAt(trace, h.f) });
      } else if (t.how.kind === 'cutoff') {
        const h = t.how;
        for (const trace of pick(mag)) { const f = crossing(trace, h.level, h.side); if (f !== null) list.push({ probe: trace.id, needs: t.needs, value: f }); }
      }
    }
    return list;
  };

  const rows: GradeRow[] = targets.map((t) => {
    const readings = readingsFor(t);
    if (!readings.length) return { label: t.label, expected: t.expected, unit: t.unit, got: null, probe: null, pass: false, hint: `Needs ${NEEDS_TEXT[t.needs]}.` };
    // prefer a probe that passes, then one that passes with the sign flipped, then the closest
    const closest = (arr: Reading[]) => arr.reduce((b, rd) => (Math.abs(rd.value - t.expected) < Math.abs(b.value - t.expected) ? rd : b));
    const passing = readings.filter((rd) => within(t, rd.value));
    const flippedOk = readings.filter((rd) => within(t, -rd.value));
    const best = passing.length ? closest(passing) : flippedOk.length ? closest(flippedOk) : closest(readings);
    const pass = within(t, best.value);
    let hint = '';
    if (!pass) {
      if (within(t, -best.value)) hint = 'Right size, wrong sign: flip the probe (swap its two points, or click the current arrow).';
      else hint = `Closest probe (${best.probe}) reads ${fmt(best.value, t.unit)}. Check part values, wiring and where the probe sits.`;
    }
    return { label: t.label, expected: t.expected, unit: t.unit, got: best.value, probe: best.probe, pass, hint };
  });
  return { rows, passed: rows.filter((x) => x.pass).length, total: rows.length };
}

export function fmt(v: number, unit: string): string {
  if (unit === '°') return `${v.toFixed(1)}°`;
  if (unit === '') return v.toPrecision(4);
  return formatSI(v, unit, 4);
}
