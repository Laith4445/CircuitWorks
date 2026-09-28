/**
 * Public entry point of the solver: diagnose, then run the requested analysis.
 */
import type { AnalysisSpec, Netlist, Result } from './netlist';
import { diagnose, hasErrors, type Diagnostic } from './diagnose';
import { solveDc } from './dc';
import { solveAc } from './ac';
import { solveTran } from './tran';

export class DiagnosticError extends Error {
  constructor(public diagnostics: Diagnostic[]) {
    super(diagnostics.filter((d) => d.severity === 'error').map((d) => d.message).join(' '));
    this.name = 'DiagnosticError';
  }
}

export interface RunOutput { result: Result; diagnostics: Diagnostic[] }

export function run(nl: Netlist, spec: AnalysisSpec): RunOutput {
  const diagnostics = diagnose(nl, spec.kind);
  if (hasErrors(diagnostics)) throw new DiagnosticError(diagnostics);
  let result: Result;
  switch (spec.kind) {
    case 'dc': result = solveDc(nl); break;
    case 'ac': result = solveAc(nl, spec); break;
    case 'tran': result = solveTran(nl, spec); break;
  }
  return { result, diagnostics };
}

export * from './netlist';
export * from './units';
export { SolverError } from './mna';
export { diagnose, hasErrors } from './diagnose';
export type { Diagnostic } from './diagnose';
export { solveDc, solveOperatingPoint } from './dc';
export { solveAc, sweepFrequencies } from './ac';
export { solveTran, defaultStep } from './tran';
