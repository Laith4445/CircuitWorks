/**
 * Core types for the solver. The engine has no DOM dependency: it takes a
 * Netlist (elements connected between named nodes, values already in SI base
 * units) plus an AnalysisSpec and returns numbers.
 *
 * Conventions (used everywhere in the engine and in the results):
 *  - Node "0" is ground. Every voltage is relative to it.
 *  - Two-terminal elements have nodes [a, b]. The reported current i[id] is the
 *    current flowing from a *through the element* to b. For a resistor that is
 *    (V(a) - V(b)) / R. For a voltage source with + at a it is the current that
 *    leaves the + terminal into the source (so a battery delivering power has a
 *    negative current). For a current source of value I, i = I (from a to b).
 *  - The element voltage is V(a) - V(b). With the current convention above,
 *    v * i is the power *absorbed* by the element (passive sign convention).
 *  - The op amp has nodes [plus, minus, out]. i[id] is the current the op amp
 *    pushes out of its output pin into the circuit.
 */

export type ElementType =
  | 'R' | 'C' | 'L'
  | 'Vdc' | 'Idc' | 'Vwave'
  | 'VCVS' | 'VCCS' | 'CCVS' | 'CCCS'
  | 'OPAMP' | 'SW';

export interface Element {
  id: string;
  type: ElementType;
  /** Node names. 2-terminal: [a, b]. OPAMP: [plus, minus, out]. */
  nodes: string[];
  /** Numeric parameters in SI units, e.g. { R: 10 }, { C: 1e-6, ic: 0 }. */
  values: Record<string, number>;
  /**
   * String options: wave 'type' ('sine'|'pulse'|'step'), switch 'init'
   * ('open'|'closed') and 'toggle' ('true'|'false'), 'ctrl' (id of the element
   * whose current or voltage controls a dependent source).
   */
  opts: Record<string, string>;
  /** For VCVS/VCCS controlled by a node pair instead of an element. */
  ctrlNodes?: [string, string];
}

export interface Netlist {
  elements: Element[];
  /** All node names, including "0" if present. */
  nodes: string[];
}

export type AnalysisSpec =
  | { kind: 'dc' }
  | { kind: 'tran'; tEnd: number; dt?: number }
  | { kind: 'ac'; fStart: number; fStop: number; pointsPerDecade?: number; log?: boolean };

export interface DcResult {
  kind: 'dc';
  v: Record<string, number>;
  i: Record<string, number>;
  notes: string[];
}

export interface TranResult {
  kind: 'tran';
  t: Float64Array;
  v: Record<string, Float64Array>;
  i: Record<string, Float64Array>;
  /** Operating point just before t = 0 (switches in their initial state). */
  op0: DcResult;
  dt: number;
  notes: string[];
}

export interface Complex { re: number; im: number }
export interface ComplexTrace { re: Float64Array; im: Float64Array }

export interface AcResult {
  kind: 'ac';
  f: Float64Array;
  v: Record<string, ComplexTrace>;
  i: Record<string, ComplexTrace>;
  notes: string[];
}

export type Result = DcResult | TranResult | AcResult;

export const GROUND = '0';

export function isTwoTerminal(e: Element): boolean {
  return e.type !== 'OPAMP';
}

/** Elements whose voltage/current relation forces a voltage (DC "short"-like). */
export function elementsById(nl: Netlist): Map<string, Element> {
  const m = new Map<string, Element>();
  for (const e of nl.elements) m.set(e.id, e);
  return m;
}
