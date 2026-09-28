/**
 * DC operating point. Two modes share one routine:
 *  - 'dc'  : capacitors open, inductors shorted (the usual DC solve).
 *  - 'ic'  : capacitors replaced by voltage sources holding their initial
 *            voltage and inductors by current sources holding their initial
 *            current. This gives the exact t = 0+ state for a transient.
 */
import { GROUND, type DcResult, type Element, type Netlist } from './netlist';
import {
  createSystem, nodeIdx, branchIdx, stampAdmittance, stampCurrentSource,
  stampVoltageSource, stampOpamp, stampDependent, dependentCurrent, stampGmin,
  solveSystem, waveValue, waveValuePre, switchClosed, vAt, SolverError,
} from './mna';

export interface OpOptions {
  switches: 'init' | 'final';
  /** 'pre' = source levels before t=0; 't0' = levels at t=0. */
  sources: 'pre' | 't0';
  reactive: 'dc' | 'ic';
  ic?: { vC: Map<string, number>; iL: Map<string, number> };
}

const DEFAULT_OP: OpOptions = { switches: 'init', sources: 'pre', reactive: 'dc' };

function sourceLevel(e: Element, opts: OpOptions): number {
  if (e.type === 'Vdc') return e.values.V ?? 0;
  return opts.sources === 'pre' ? waveValuePre(e) : waveValue(e, 0);
}

export function needsBranchOp(e: Element, opts: OpOptions): boolean {
  switch (e.type) {
    case 'Vdc': case 'Vwave': case 'OPAMP': case 'VCVS': case 'CCVS': return true;
    case 'L': return opts.reactive === 'dc';
    case 'C': return opts.reactive === 'ic';
    case 'SW': return switchClosed(e, opts.switches);
    default: return false;
  }
}

export function solveOperatingPoint(nl: Netlist, opts: OpOptions = DEFAULT_OP): DcResult {
  const branchIds = nl.elements.filter((e) => needsBranchOp(e, opts)).map((e) => e.id);
  const sys = createSystem(nl, branchIds, false);
  const notes: string[] = [];

  for (const e of nl.elements) {
    const a = e.type === 'OPAMP' ? -1 : nodeIdx(sys, e.nodes[0]);
    const b = e.type === 'OPAMP' ? -1 : nodeIdx(sys, e.nodes[1]);
    switch (e.type) {
      case 'R':
        if (!(e.values.R > 0)) throw new SolverError(`${e.id}'s resistance must be greater than zero.`, [e.id]);
        stampAdmittance(sys, a, b, 1 / e.values.R);
        break;
      case 'C':
        if (opts.reactive === 'ic') {
          const v0 = opts.ic?.vC.get(e.id) ?? 0;
          stampVoltageSource(sys, a, b, branchIdx(sys, e.id), v0);
        }
        break;
      case 'L':
        if (opts.reactive === 'dc') stampVoltageSource(sys, a, b, branchIdx(sys, e.id), 0);
        else stampCurrentSource(sys, a, b, opts.ic?.iL.get(e.id) ?? 0);
        break;
      case 'Vdc':
      case 'Vwave':
        stampVoltageSource(sys, a, b, branchIdx(sys, e.id), sourceLevel(e, opts));
        break;
      case 'Idc':
        stampCurrentSource(sys, a, b, e.values.I ?? 0);
        break;
      case 'VCVS': case 'VCCS': case 'CCVS': case 'CCCS':
        stampDependent(nl, sys, e);
        break;
      case 'OPAMP':
        stampOpamp(sys, nodeIdx(sys, e.nodes[0]), nodeIdx(sys, e.nodes[1]), nodeIdx(sys, e.nodes[2]), branchIdx(sys, e.id));
        break;
      case 'SW':
        if (switchClosed(e, opts.switches)) stampVoltageSource(sys, a, b, branchIdx(sys, e.id), 0);
        break;
    }
  }
  stampGmin(sys);
  const x = solveSystem(sys);

  const v: Record<string, number> = { [GROUND]: 0 };
  for (const [name, idx] of sys.node) v[name] = x.xre[idx];

  const i: Record<string, number> = {};
  for (const e of nl.elements) {
    if (e.type === 'OPAMP') { i[e.id] = x.xre[branchIdx(sys, e.id)]; continue; }
    const va = vAt(x.xre, nodeIdx(sys, e.nodes[0]));
    const vb = vAt(x.xre, nodeIdx(sys, e.nodes[1]));
    switch (e.type) {
      case 'R': i[e.id] = (va - vb) / e.values.R; break;
      case 'C': i[e.id] = opts.reactive === 'ic' ? x.xre[branchIdx(sys, e.id)] : 0; break;
      case 'L': i[e.id] = opts.reactive === 'dc' ? x.xre[branchIdx(sys, e.id)] : (opts.ic?.iL.get(e.id) ?? 0); break;
      case 'Vdc': case 'Vwave': i[e.id] = x.xre[branchIdx(sys, e.id)]; break;
      case 'Idc': i[e.id] = e.values.I ?? 0; break;
      case 'VCVS': case 'VCCS': case 'CCVS': case 'CCCS': i[e.id] = dependentCurrent(nl, sys, e, x).re; break;
      case 'SW': i[e.id] = switchClosed(e, opts.switches) ? x.xre[branchIdx(sys, e.id)] : 0; break;
    }
  }
  return { kind: 'dc', v, i, notes };
}

/** The plain "DC Operating Point" analysis. */
export function solveDc(nl: Netlist): DcResult {
  return solveOperatingPoint(nl, DEFAULT_OP);
}
