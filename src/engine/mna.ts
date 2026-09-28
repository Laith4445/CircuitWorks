/**
 * Modified nodal analysis: the linear system and the element "stamps".
 *
 * Unknown vector x = [node voltages (ground removed)..., branch currents...].
 * KCL rows are written as "sum of currents leaving the node into elements = 0".
 * Branch rows are the element's voltage constraint. The system can be complex
 * (AC): it is kept as separate real/imaginary parts and solved as a real
 * 2n x 2n system, so one real LU routine serves everything.
 */
import { GROUND, type Element, type Netlist } from './netlist';
import { luFactor, luSolve, SingularMatrixError, type LU } from './linalg';

export class SolverError extends Error {
  constructor(message: string, public ids: string[] = []) {
    super(message);
    this.name = 'SolverError';
  }
}

export interface System {
  n: number;
  nNodes: number;
  Are: Float64Array;
  Aim: Float64Array;
  zre: Float64Array;
  zim: Float64Array;
  complex: boolean;
  node: Map<string, number>;     // node name -> index (ground absent)
  branch: Map<string, number>;   // element id -> branch row/col index
  /** which unknown row belongs to which element (for error highlighting) */
  rowOwner: string[];
}

export function createSystem(nl: Netlist, branchIds: string[], complex = false): System {
  const node = new Map<string, number>();
  let k = 0;
  for (const name of nl.nodes) if (name !== GROUND) node.set(name, k++);
  const nNodes = k;
  const branch = new Map<string, number>();
  for (const id of branchIds) branch.set(id, k++);
  const n = k;
  const rowOwner: string[] = new Array(n).fill('');
  for (const [id, idx] of branch) rowOwner[idx] = id;
  return {
    n, nNodes, complex, node, branch, rowOwner,
    Are: new Float64Array(n * n), Aim: new Float64Array(n * n),
    zre: new Float64Array(n), zim: new Float64Array(n),
  };
}

export function nodeIdx(sys: System, name: string): number {
  if (name === GROUND) return -1;
  const i = sys.node.get(name);
  if (i === undefined) throw new SolverError(`Unknown node "${name}".`);
  return i;
}

export function branchIdx(sys: System, id: string): number {
  const k = sys.branch.get(id);
  if (k === undefined) throw new SolverError(`No branch current for "${id}".`);
  return k;
}

export function clearRhs(sys: System): void {
  sys.zre.fill(0);
  sys.zim.fill(0);
}

// ---- primitive stamps ------------------------------------------------------

function addA(sys: System, r: number, c: number, re: number, im = 0): void {
  if (r < 0 || c < 0) return;
  sys.Are[r * sys.n + c] += re;
  if (im !== 0) { sys.Aim[r * sys.n + c] += im; sys.complex = true; }
}

function addZ(sys: System, r: number, re: number, im = 0): void {
  if (r < 0) return;
  sys.zre[r] += re;
  if (im !== 0) { sys.zim[r] += im; sys.complex = true; }
}

/** Admittance y between nodes a and b (real conductance or complex jwC). */
export function stampAdmittance(sys: System, a: number, b: number, yre: number, yim = 0): void {
  addA(sys, a, a, yre, yim); addA(sys, b, b, yre, yim);
  addA(sys, a, b, -yre, -yim); addA(sys, b, a, -yre, -yim);
}

/** Independent current source: current I flows from a through the source to b. */
export function stampCurrentSource(sys: System, a: number, b: number, ire: number, iim = 0): void {
  addZ(sys, a, -ire, -iim);
  addZ(sys, b, ire, iim);
}

/** Branch current k flows from a to b through the element (KCL part only). */
export function stampBranchKcl(sys: System, a: number, b: number, k: number): void {
  addA(sys, a, k, 1);
  addA(sys, b, k, -1);
}

/** Row k: V(a) - V(b) - Z * I_k = rhs.   (Z = 0 gives an ideal voltage source.) */
export function stampBranchRow(sys: System, a: number, b: number, k: number,
  zre: number, zim: number, rhsRe: number, rhsIm = 0): void {
  addA(sys, k, a, 1);
  addA(sys, k, b, -1);
  addA(sys, k, k, -zre, -zim);
  addZ(sys, k, rhsRe, rhsIm);
}

/** Ideal voltage source V from a(+) to b(-) with branch k. */
export function stampVoltageSource(sys: System, a: number, b: number, k: number, vre: number, vim = 0): void {
  stampBranchKcl(sys, a, b, k);
  stampBranchRow(sys, a, b, k, 0, 0, vre, vim);
}

/** VCCS: current g*(V(c)-V(d)) flows from a through the source to b. */
export function stampVCCS(sys: System, a: number, b: number, c: number, d: number, g: number): void {
  addA(sys, a, c, g); addA(sys, a, d, -g);
  addA(sys, b, c, -g); addA(sys, b, d, g);
}

/** VCVS: V(a) - V(b) = mu*(V(c) - V(d)), branch k. */
export function stampVCVS(sys: System, a: number, b: number, c: number, d: number, k: number, mu: number): void {
  stampBranchKcl(sys, a, b, k);
  addA(sys, k, a, 1); addA(sys, k, b, -1);
  addA(sys, k, c, -mu); addA(sys, k, d, mu);
}

/** CCCS controlled by branch current kc: current beta*I_kc flows a -> b. */
export function stampCCCSBranch(sys: System, a: number, b: number, kc: number, beta: number): void {
  addA(sys, a, kc, beta);
  addA(sys, b, kc, -beta);
}

/** CCVS controlled by branch current kc: V(a)-V(b) = r*I_kc, own branch k. */
export function stampCCVSBranch(sys: System, a: number, b: number, k: number, kc: number, r: number): void {
  stampBranchKcl(sys, a, b, k);
  addA(sys, k, a, 1); addA(sys, k, b, -1);
  addA(sys, k, kc, -r);
}

/** Ideal op amp: output current unknown k (out of the op amp into node o); V(p) = V(m). */
export function stampOpamp(sys: System, p: number, m: number, o: number, k: number): void {
  addA(sys, o, k, -1);          // current entering node o from the op amp
  addA(sys, k, p, 1); addA(sys, k, m, -1);
}

// ---- solving -----------------------------------------------------------------

export interface Solution { xre: Float64Array; xim: Float64Array }

export interface Factored {
  lu: LU;
  complex: boolean;
  n: number;
}

export function factor(sys: System): Factored {
  const n = sys.n;
  try {
    if (!sys.complex) {
      return { lu: luFactor(sys.Are, n), complex: false, n };
    }
    // [[G, -B], [B, G]] [xr; xi] = [zr; zi]
    const N = 2 * n;
    const M = new Float64Array(N * N);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const g = sys.Are[i * n + j];
        const b = sys.Aim[i * n + j];
        M[i * N + j] = g;
        M[i * N + (j + n)] = -b;
        M[(i + n) * N + j] = b;
        M[(i + n) * N + (j + n)] = g;
      }
    }
    return { lu: luFactor(M, N), complex: true, n };
  } catch (e) {
    if (e instanceof SingularMatrixError) {
      const row = e.row % n;
      const owner = row >= sys.nNodes ? sys.rowOwner[row] : nodeName(sys, row);
      throw new SolverError(
        "The solver couldn't solve this circuit. This usually means an ideal element is " +
        'forced into an impossible state. Highlighted parts are the most likely cause.',
        owner ? [owner] : []);
    }
    throw e;
  }
}

export function solveWith(f: Factored, sys: System): Solution {
  const n = sys.n;
  if (!f.complex) {
    return { xre: luSolve(f.lu, sys.zre), xim: new Float64Array(n) };
  }
  const N = 2 * n;
  const b = new Float64Array(N);
  b.set(sys.zre, 0);
  b.set(sys.zim, n);
  const x = luSolve(f.lu, b);
  return { xre: x.subarray(0, n), xim: x.subarray(n, N) };
}

export function solveSystem(sys: System): Solution {
  return solveWith(factor(sys), sys);
}

export function nodeName(sys: System, idx: number): string {
  for (const [name, i] of sys.node) if (i === idx) return name;
  return '';
}

/** Voltage of node index (ground = 0). */
export function vAt(x: Float64Array, idx: number): number {
  return idx < 0 ? 0 : x[idx];
}

// ---- source helpers -------------------------------------------------------------

/** Value of a waveform voltage source at time t (seconds). */
export function waveValue(e: Element, t: number): number {
  const v = e.values;
  const type = e.opts.type ?? 'sine';
  if (type === 'pulse' || type === 'step') {
    const v1 = v.v1 ?? 0, v2 = v.v2 ?? 0;
    const td = v.td ?? 0, tr = v.tr ?? 0, tf = v.tf ?? 0;
    if (t < td) return v1;
    let tt = t - td;
    if (type === 'pulse') {
      const pw = v.pw ?? 0, per = v.per ?? 0;
      if (per > 0) tt = tt % per;
      if (tt < tr) return tr > 0 ? v1 + (v2 - v1) * tt / tr : v2;
      if (tt < tr + pw) return v2;
      if (tt < tr + pw + tf) return tf > 0 ? v2 + (v1 - v2) * (tt - tr - pw) / tf : v1;
      return v1;
    }
    // step
    if (tt < tr) return tr > 0 ? v1 + (v2 - v1) * tt / tr : v2;
    return v2;
  }
  // sine: vo + va*sin(2*pi*f*(t-td) + phase)
  const vo = v.vo ?? 0, va = v.va ?? 0, f = v.f ?? 0, td = v.td ?? 0;
  const ph = ((v.phase ?? 0) * Math.PI) / 180;
  if (t < td) return vo + va * Math.sin(ph);
  return vo + va * Math.sin(2 * Math.PI * f * (t - td) + ph);
}

/** Source level "before t = 0": DC sources on; pulse/step at their first level; sine at its offset. */
export function waveValuePre(e: Element): number {
  const type = e.opts.type ?? 'sine';
  if (type === 'pulse' || type === 'step') return e.values.v1 ?? 0;
  return e.values.vo ?? 0;
}

/** AC phasor of a source (peak amplitude, degrees) for the frequency sweep. */
export function acPhasor(e: Element): { re: number; im: number } {
  if (e.type !== 'Vwave') return { re: 0, im: 0 };
  const mag = e.values.acMag ?? 0;
  const ph = ((e.values.acPhase ?? 0) * Math.PI) / 180;
  return { re: mag * Math.cos(ph), im: mag * Math.sin(ph) };
}

/** Is the switch closed in the requested state? */
export function switchClosed(e: Element, state: 'init' | 'final'): boolean {
  const init = (e.opts.init ?? 'open') === 'closed';
  if (state === 'init') return init;
  const toggle = (e.opts.toggle ?? 'true') !== 'false';
  return toggle ? !init : init;
}

/**
 * How a dependent source's controlling current is obtained:
 *  - through a resistor: (V(a) - V(b)) / R  (a "VCCS in disguise")
 *  - through an element with a branch current: that unknown.
 */
export type CtrlCurrent =
  | { kind: 'branch'; k: number }
  | { kind: 'resistor'; a: number; b: number; g: number };

export function controllingCurrent(nl: Netlist, sys: System, e: Element): CtrlCurrent {
  const id = e.opts.ctrl;
  const ctrl = nl.elements.find((x) => x.id === id);
  if (!ctrl) throw new SolverError(`${e.id} is controlled by "${id ?? '?'}", which doesn't exist.`, [e.id]);
  if (ctrl.type === 'R') {
    return { kind: 'resistor', a: nodeIdx(sys, ctrl.nodes[0]), b: nodeIdx(sys, ctrl.nodes[1]), g: 1 / ctrl.values.R };
  }
  const k = sys.branch.get(ctrl.id);
  if (k === undefined) {
    throw new SolverError(
      `${e.id} is controlled by the current through ${ctrl.id}, but the solver can only sense current ` +
      'through a resistor, voltage source, inductor, switch or op-amp output in this version.', [e.id, ctrl.id]);
  }
  return { kind: 'branch', k };
}

export function controllingVoltage(nl: Netlist, sys: System, e: Element): { c: number; d: number } {
  if (e.ctrlNodes) return { c: nodeIdx(sys, e.ctrlNodes[0]), d: nodeIdx(sys, e.ctrlNodes[1]) };
  const id = e.opts.ctrl;
  const ctrl = nl.elements.find((x) => x.id === id);
  if (!ctrl) throw new SolverError(`${e.id} is controlled by "${id ?? '?'}", which doesn't exist.`, [e.id]);
  return { c: nodeIdx(sys, ctrl.nodes[0]), d: nodeIdx(sys, ctrl.nodes[1]) };
}

/** Stamp a dependent source (all four kinds). Returns nothing; currents are read back later. */
export function stampDependent(nl: Netlist, sys: System, e: Element): void {
  const a = nodeIdx(sys, e.nodes[0]);
  const b = nodeIdx(sys, e.nodes[1]);
  const gain = e.values.gain ?? 0;
  switch (e.type) {
    case 'VCVS': {
      const { c, d } = controllingVoltage(nl, sys, e);
      stampVCVS(sys, a, b, c, d, branchIdx(sys, e.id), gain);
      return;
    }
    case 'VCCS': {
      const { c, d } = controllingVoltage(nl, sys, e);
      stampVCCS(sys, a, b, c, d, gain);
      return;
    }
    case 'CCCS': {
      const cc = controllingCurrent(nl, sys, e);
      if (cc.kind === 'branch') stampCCCSBranch(sys, a, b, cc.k, gain);
      else stampVCCS(sys, a, b, cc.a, cc.b, gain * cc.g);
      return;
    }
    case 'CCVS': {
      const cc = controllingCurrent(nl, sys, e);
      const k = branchIdx(sys, e.id);
      if (cc.kind === 'branch') stampCCVSBranch(sys, a, b, k, cc.k, gain);
      else stampVCVS(sys, a, b, cc.a, cc.b, k, gain * cc.g);
      return;
    }
    default:
      throw new SolverError(`${e.id} is not a dependent source.`);
  }
}

/** Current a->b through a dependent source, given the solution. */
export function dependentCurrent(nl: Netlist, sys: System, e: Element, x: Solution): { re: number; im: number } {
  const gain = e.values.gain ?? 0;
  switch (e.type) {
    case 'VCVS':
    case 'CCVS': {
      const k = branchIdx(sys, e.id);
      return { re: x.xre[k], im: x.xim[k] };
    }
    case 'VCCS': {
      const { c, d } = controllingVoltage(nl, sys, e);
      return {
        re: gain * (vAt(x.xre, c) - vAt(x.xre, d)),
        im: gain * (vAt(x.xim, c) - vAt(x.xim, d)),
      };
    }
    case 'CCCS': {
      const cc = controllingCurrent(nl, sys, e);
      if (cc.kind === 'branch') return { re: gain * x.xre[cc.k], im: gain * x.xim[cc.k] };
      const g = gain * cc.g;
      return {
        re: g * (vAt(x.xre, cc.a) - vAt(x.xre, cc.b)),
        im: g * (vAt(x.xim, cc.a) - vAt(x.xim, cc.b)),
      };
    }
    default:
      throw new SolverError(`${e.id} is not a dependent source.`);
  }
}

export const GMIN = 1e-12;

export function stampGmin(sys: System): void {
  for (let i = 0; i < sys.nNodes; i++) sys.Are[i * sys.n + i] += GMIN;
}
