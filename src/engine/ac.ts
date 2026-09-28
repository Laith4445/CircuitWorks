/**
 * AC sweep: one complex solve per frequency. Sources are phasors with the
 * peak amplitude given as acMag (book convention, SPEC §6.4). DC sources are
 * zero (shorted) in AC; DC current sources are open.
 */
import { GROUND, type AcResult, type Netlist, type AnalysisSpec } from './netlist';
import {
  createSystem, nodeIdx, branchIdx, stampAdmittance, stampVoltageSource,
  stampBranchKcl, stampBranchRow, stampOpamp, stampDependent, dependentCurrent,
  solveSystem, acPhasor, switchClosed, vAt, SolverError,
} from './mna';

export function sweepFrequencies(fStart: number, fStop: number, pointsPerDecade = 100, log = true): Float64Array {
  if (!(fStart > 0) || !(fStop > fStart)) throw new SolverError('The frequency sweep needs 0 < start < stop.');
  if (!log) {
    const n = Math.max(2, Math.round(pointsPerDecade));
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = fStart + (fStop - fStart) * i / (n - 1);
    return out;
  }
  const decades = Math.log10(fStop / fStart);
  const n = Math.max(2, Math.ceil(decades * pointsPerDecade) + 1);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = fStart * Math.pow(10, decades * i / (n - 1));
  out[n - 1] = fStop;
  return out;
}

export function solveAc(nl: Netlist, spec: Extract<AnalysisSpec, { kind: 'ac' }>): AcResult {
  const f = sweepFrequencies(spec.fStart, spec.fStop, spec.pointsPerDecade ?? 100, spec.log ?? true);
  const N = f.length;
  const branchIds = nl.elements.filter((e) =>
    e.type === 'Vdc' || e.type === 'Vwave' || e.type === 'L' || e.type === 'OPAMP' ||
    e.type === 'VCVS' || e.type === 'CCVS' || (e.type === 'SW' && switchClosed(e, 'init'))).map((e) => e.id);

  const v: AcResult['v'] = { [GROUND]: { re: new Float64Array(N), im: new Float64Array(N) } };
  for (const name of nl.nodes) if (name !== GROUND) v[name] = { re: new Float64Array(N), im: new Float64Array(N) };
  const i: AcResult['i'] = {};
  for (const e of nl.elements) i[e.id] = { re: new Float64Array(N), im: new Float64Array(N) };

  for (let p = 0; p < N; p++) {
    const w = 2 * Math.PI * f[p];
    const sys = createSystem(nl, branchIds, true);
    for (const e of nl.elements) {
      const a = e.type === 'OPAMP' ? -1 : nodeIdx(sys, e.nodes[0]);
      const b = e.type === 'OPAMP' ? -1 : nodeIdx(sys, e.nodes[1]);
      switch (e.type) {
        case 'R': stampAdmittance(sys, a, b, 1 / e.values.R); break;
        case 'C': stampAdmittance(sys, a, b, 0, w * e.values.C); break;
        case 'L': {
          const k = branchIdx(sys, e.id);
          stampBranchKcl(sys, a, b, k);
          stampBranchRow(sys, a, b, k, 0, w * e.values.L, 0, 0);
          break;
        }
        case 'Vdc': stampVoltageSource(sys, a, b, branchIdx(sys, e.id), 0); break;
        case 'Vwave': {
          const ph = acPhasor(e);
          stampVoltageSource(sys, a, b, branchIdx(sys, e.id), ph.re, ph.im);
          break;
        }
        case 'Idc': break;
        case 'VCVS': case 'VCCS': case 'CCVS': case 'CCCS': stampDependent(nl, sys, e); break;
        case 'OPAMP':
          stampOpamp(sys, nodeIdx(sys, e.nodes[0]), nodeIdx(sys, e.nodes[1]), nodeIdx(sys, e.nodes[2]), branchIdx(sys, e.id));
          break;
        case 'SW':
          if (switchClosed(e, 'init')) stampVoltageSource(sys, a, b, branchIdx(sys, e.id), 0);
          break;
      }
    }
    // A tiny conductance to ground keeps nodes that hang only off capacitors defined.
    for (let q = 0; q < sys.nNodes; q++) sys.Are[q * sys.n + q] += 1e-15;
    sys.complex = true;
    const x = solveSystem(sys);

    for (const [name, idx] of sys.node) { v[name].re[p] = x.xre[idx]; v[name].im[p] = x.xim[idx]; }
    for (const e of nl.elements) {
      let re = 0, im = 0;
      if (e.type === 'OPAMP') {
        const k = branchIdx(sys, e.id); re = x.xre[k]; im = x.xim[k];
      } else {
        const a = nodeIdx(sys, e.nodes[0]), b = nodeIdx(sys, e.nodes[1]);
        const vre = vAt(x.xre, a) - vAt(x.xre, b);
        const vim = vAt(x.xim, a) - vAt(x.xim, b);
        switch (e.type) {
          case 'R': re = vre / e.values.R; im = vim / e.values.R; break;
          case 'C': { const y = w * e.values.C; re = -y * vim; im = y * vre; break; }   // I = jwC V
          case 'L': case 'Vdc': case 'Vwave': { const k = branchIdx(sys, e.id); re = x.xre[k]; im = x.xim[k]; break; }
          case 'Idc': break;
          case 'VCVS': case 'VCCS': case 'CCVS': case 'CCCS': ({ re, im } = dependentCurrent(nl, sys, e, x)); break;
          case 'SW': if (switchClosed(e, 'init')) { const k = branchIdx(sys, e.id); re = x.xre[k]; im = x.xim[k]; } break;
        }
      }
      i[e.id].re[p] = re; i[e.id].im[p] = im;
    }
  }
  return { kind: 'ac', f, v, i, notes: [] };
}
