/**
 * Transient ("Time") analysis, SPEC §4.2–4.5.
 *
 *  1. Operating point before t = 0: switches in their initial state, sources at
 *     their pre-t=0 level, capacitors open, inductors shorted. That gives each
 *     capacitor's voltage and inductor's current at t = 0-. Explicit "ic"
 *     values on a part override this.
 *  2. Exact t = 0+ solve: switches flipped, sources at their t = 0 value,
 *     capacitors held at v(0-), inductors at i(0-). This gives the correct
 *     starting values for the quantities that jump (currents into capacitors,
 *     voltages across inductors, node voltages).
 *  3. Fixed-step trapezoidal integration from t = 0 using companion models.
 *     The matrix is constant (linear circuit, fixed step) so it is factored
 *     once; only the right-hand side changes per step.
 */
import { GROUND, type AnalysisSpec, type Element, type Netlist, type TranResult } from './netlist';
import { solveOperatingPoint } from './dc';
import {
  createSystem, nodeIdx, branchIdx, stampAdmittance, stampCurrentSource,
  stampVoltageSource, stampBranchKcl, stampBranchRow, stampOpamp, stampDependent,
  dependentCurrent, factor, solveWith, clearRhs, waveValue, switchClosed, vAt, SolverError,
} from './mna';

export const MAX_POINTS = 200_000;

/**
 * Default step per SPEC §4.3: min(tEnd/2000, smallest time constant / 20).
 * Time constants: RC and L/R for R–C / R–L pairs sharing a node; sqrt(LC) for
 * any L and C in the circuit.
 */
export function defaultStep(nl: Netlist, tEnd: number): number {
  let tauMin = Infinity;
  const byNode = new Map<string, Element[]>();
  for (const e of nl.elements) {
    if (e.type !== 'R' && e.type !== 'C' && e.type !== 'L') continue;
    for (const n of e.nodes) {
      if (!byNode.has(n)) byNode.set(n, []);
      byNode.get(n)!.push(e);
    }
  }
  for (const list of byNode.values()) {
    for (const r of list) {
      if (r.type !== 'R') continue;
      for (const x of list) {
        if (x.type === 'C') tauMin = Math.min(tauMin, r.values.R * x.values.C);
        if (x.type === 'L') tauMin = Math.min(tauMin, x.values.L / r.values.R);
      }
    }
  }
  const Ls = nl.elements.filter((e) => e.type === 'L');
  const Cs = nl.elements.filter((e) => e.type === 'C');
  for (const l of Ls) for (const c of Cs) tauMin = Math.min(tauMin, Math.sqrt(l.values.L * c.values.C));
  let h = tEnd / 2000;
  if (Number.isFinite(tauMin) && tauMin > 0) h = Math.min(h, tauMin / 20);
  return h;
}

export function solveTran(nl: Netlist, spec: Extract<AnalysisSpec, { kind: 'tran' }>): TranResult {
  const notes: string[] = [];
  if (!(spec.tEnd > 0)) throw new SolverError('The end time must be greater than zero.');

  // --- phase 1: t = 0- operating point ---------------------------------------
  const op0 = solveOperatingPoint(nl, { switches: 'init', sources: 'pre', reactive: 'dc' });
  const vC = new Map<string, number>();
  const iL = new Map<string, number>();
  for (const e of nl.elements) {
    if (e.type === 'C') vC.set(e.id, e.values.ic ?? (op0.v[e.nodes[0]] - op0.v[e.nodes[1]]));
    if (e.type === 'L') iL.set(e.id, e.values.ic ?? op0.i[e.id]);
  }

  // --- phase 2: exact t = 0+ --------------------------------------------------
  const x0 = solveOperatingPoint(nl, { switches: 'final', sources: 't0', reactive: 'ic', ic: { vC, iL } });

  // --- phase 3: time stepping -------------------------------------------------
  let h = spec.dt && spec.dt > 0 ? spec.dt : defaultStep(nl, spec.tEnd);
  let N = Math.max(1, Math.round(spec.tEnd / h));
  if (N > MAX_POINTS) {
    notes.push(`The time step was increased to keep the run under ${MAX_POINTS.toLocaleString()} points; fast details may be smoothed.`);
    N = MAX_POINTS;
  }
  h = spec.tEnd / N;

  const branchIds = nl.elements.filter((e) =>
    e.type === 'Vdc' || e.type === 'Vwave' || e.type === 'L' || e.type === 'OPAMP' ||
    e.type === 'VCVS' || e.type === 'CCVS' || (e.type === 'SW' && switchClosed(e, 'final'))).map((e) => e.id);
  const sys = createSystem(nl, branchIds, false);

  // constant part of the matrix
  for (const e of nl.elements) {
    const a = e.type === 'OPAMP' ? -1 : nodeIdx(sys, e.nodes[0]);
    const b = e.type === 'OPAMP' ? -1 : nodeIdx(sys, e.nodes[1]);
    switch (e.type) {
      case 'R': stampAdmittance(sys, a, b, 1 / e.values.R); break;
      case 'C': stampAdmittance(sys, a, b, 2 * e.values.C / h); break;               // Geq = 2C/h
      case 'L': {
        const k = branchIdx(sys, e.id);
        stampBranchKcl(sys, a, b, k);
        stampBranchRow(sys, a, b, k, 2 * e.values.L / h, 0, 0);                    // V - Req*I = rhs
        break;
      }
      case 'Vdc': case 'Vwave': stampVoltageSource(sys, a, b, branchIdx(sys, e.id), 0); break;
      case 'Idc': break;
      case 'VCVS': case 'VCCS': case 'CCVS': case 'CCCS': stampDependent(nl, sys, e); break;
      case 'OPAMP':
        stampOpamp(sys, nodeIdx(sys, e.nodes[0]), nodeIdx(sys, e.nodes[1]), nodeIdx(sys, e.nodes[2]), branchIdx(sys, e.id));
        break;
      case 'SW':
        if (switchClosed(e, 'final')) stampVoltageSource(sys, a, b, branchIdx(sys, e.id), 0);
        break;
    }
  }
  for (let q = 0; q < sys.nNodes; q++) sys.Are[q * sys.n + q] += 1e-12;
  const fac = factor(sys);

  // traces
  const t = new Float64Array(N + 1);
  const v: Record<string, Float64Array> = { [GROUND]: new Float64Array(N + 1) };
  for (const name of nl.nodes) if (name !== GROUND) v[name] = new Float64Array(N + 1);
  const i: Record<string, Float64Array> = {};
  for (const e of nl.elements) i[e.id] = new Float64Array(N + 1);

  for (const name of nl.nodes) v[name][0] = x0.v[name];
  for (const e of nl.elements) i[e.id][0] = x0.i[e.id];

  // state for companion models: previous element voltage and current
  const caps = nl.elements.filter((e) => e.type === 'C');
  const inds = nl.elements.filter((e) => e.type === 'L');
  const capV = new Map<string, number>(), capI = new Map<string, number>();
  const indV = new Map<string, number>(), indI = new Map<string, number>();
  for (const c of caps) { capV.set(c.id, x0.v[c.nodes[0]] - x0.v[c.nodes[1]]); capI.set(c.id, x0.i[c.id]); }
  for (const l of inds) { indV.set(l.id, x0.v[l.nodes[0]] - x0.v[l.nodes[1]]); indI.set(l.id, x0.i[l.id]); }

  const twoTerm = nl.elements.filter((e) => e.type !== 'OPAMP').map((e) => ({
    e, a: nodeIdx(sys, e.nodes[0]), b: nodeIdx(sys, e.nodes[1]),
  }));

  for (let n = 1; n <= N; n++) {
    const tn = n * h;
    t[n] = tn;
    clearRhs(sys);
    for (const { e, a, b } of twoTerm) {
      switch (e.type) {
        case 'C': {
          const Geq = 2 * e.values.C / h;
          const Ieq = Geq * capV.get(e.id)! + capI.get(e.id)!;
          // i(n+1) = Geq*v(n+1) - Ieq  -> constant part is a source of Ieq into a
          stampCurrentSource(sys, b, a, Ieq);
          break;
        }
        case 'L': {
          const Req = 2 * e.values.L / h;
          sys.zre[branchIdx(sys, e.id)] += -(Req * indI.get(e.id)! + indV.get(e.id)!);
          break;
        }
        case 'Vdc': sys.zre[branchIdx(sys, e.id)] += e.values.V ?? 0; break;
        case 'Vwave': sys.zre[branchIdx(sys, e.id)] += waveValue(e, tn); break;
        case 'Idc': stampCurrentSource(sys, a, b, e.values.I ?? 0); break;
        default: break;
      }
    }
    const x = solveWith(fac, sys);

    for (const [name, idx] of sys.node) v[name][n] = x.xre[idx];
    for (const { e, a, b } of twoTerm) {
      const ve = vAt(x.xre, a) - vAt(x.xre, b);
      let cur = 0;
      switch (e.type) {
        case 'R': cur = ve / e.values.R; break;
        case 'C': {
          const Geq = 2 * e.values.C / h;
          cur = Geq * (ve - capV.get(e.id)!) - capI.get(e.id)!;
          capV.set(e.id, ve); capI.set(e.id, cur);
          break;
        }
        case 'L': cur = x.xre[branchIdx(sys, e.id)]; indV.set(e.id, ve); indI.set(e.id, cur); break;
        case 'Vdc': case 'Vwave': cur = x.xre[branchIdx(sys, e.id)]; break;
        case 'Idc': cur = e.values.I ?? 0; break;
        case 'VCVS': case 'VCCS': case 'CCVS': case 'CCCS': cur = dependentCurrent(nl, sys, e, x).re; break;
        case 'SW': cur = switchClosed(e, 'final') ? x.xre[branchIdx(sys, e.id)] : 0; break;
        default: break;
      }
      i[e.id][n] = cur;
    }
    for (const e of nl.elements) if (e.type === 'OPAMP') i[e.id][n] = x.xre[branchIdx(sys, e.id)];
  }

  return { kind: 'tran', t, v, i, op0, dt: h, notes };
}
