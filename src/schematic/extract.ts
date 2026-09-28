/**
 * Turn drawn geometry into a Netlist ("netlist extraction").
 *
 * Connection rules (SPEC §5, §9.1):
 *  - A wire connects its two endpoints.
 *  - A pin connects to anything whose point coincides with it (wire endpoint
 *    or another pin). Pin-to-pin with no wire counts as connected.
 *  - A wire endpoint lying on the *interior* of another wire is a T-junction
 *    and connects. Two collinear overlapping wires connect the same way.
 *  - A wire passing over a pin without ending there does NOT connect.
 *  - All ground pins are node "0".
 */
import type { Element, ElementType, Netlist } from '../engine/netlist';
import { GROUND } from '../engine/netlist';
import type { Diagnostic } from '../engine/diagnose';
import { parseValue } from '../engine/units';
import { key, pinPositions, pointOnSegment, type Circuit, type Point } from './model';

class UF {
  private p = new Map<string, string>();
  find(x: string): string {
    let r = this.p.get(x);
    if (r === undefined) { this.p.set(x, x); return x; }
    if (r !== x) { r = this.find(r); this.p.set(x, r); }
    return r;
  }
  union(a: string, b: string): void { this.p.set(this.find(a), this.find(b)); }
}

export interface Extraction {
  netlist: Netlist;
  /** Node name for any drawn point (pins, wire endpoints); use nodeAtPoint for wire interiors. */
  nodeOfPoint: Map<string, string>;
  nodeAtPoint: (p: Point) => string | undefined;
  diagnostics: Diagnostic[];
}

const STRING_PARAMS = new Set(['type', 'init', 'toggle', 'ctrl', 'ctrlA', 'ctrlB']);

export function extract(circuit: Circuit): Extraction {
  const diagnostics: Diagnostic[] = [];
  const uf = new UF();

  // 1. wires connect their endpoints
  for (const w of circuit.wires) uf.union(key(w.from), key(w.to));

  // 2. wire endpoints on the interior of another wire (T-junction / overlap)
  for (const w of circuit.wires) {
    for (const p of [w.from, w.to]) {
      for (const o of circuit.wires) {
        if (o === w) continue;
        if (pointOnSegment(p, o.from, o.to)) uf.union(key(p), key(o.from));
      }
    }
  }

  // 3. pins join whatever sits at their point (pins, wire ends). Grounds join "0".
  const pinKeys: { part: string; type: string; pin: string; k: string }[] = [];
  for (const part of circuit.parts) {
    for (const pin of pinPositions(part)) {
      const k = key(pin);
      uf.find(k);
      pinKeys.push({ part: part.id, type: part.type, pin: pin.name, k });
      if (part.type === 'GND') uf.union(k, '__ground__');
    }
  }

  // 4. name the components: "0" for ground, labels where given, n1, n2, ... otherwise
  const nameOfRoot = new Map<string, string>();
  nameOfRoot.set(uf.find('__ground__'), GROUND);
  const rootOfPoint = (p: Point): string | undefined => {
    const k = key(p);
    // exact point?
    const pk = pinKeys.find((x) => x.k === k);
    if (pk) return uf.find(k);
    for (const w of circuit.wires) {
      if (pointOnSegment(p, w.from, w.to)) return uf.find(key(w.from));
    }
    return undefined;
  };
  for (const lab of circuit.labels ?? []) {
    const r = rootOfPoint(lab.at);
    if (!r) { diagnostics.push({ severity: 'warn', message: `Label "${lab.text}" isn't on any wire or pin.`, ids: [] }); continue; }
    if (nameOfRoot.has(r) && nameOfRoot.get(r) !== lab.text) {
      if (nameOfRoot.get(r) === GROUND) continue; // ground keeps its name
      diagnostics.push({ severity: 'warn', message: `Labels "${nameOfRoot.get(r)}" and "${lab.text}" are on the same node; using "${nameOfRoot.get(r)}".`, ids: [] });
      continue;
    }
    nameOfRoot.set(r, lab.text);
  }
  let counter = 1;
  const nameOf = (r: string): string => {
    let n = nameOfRoot.get(r);
    if (n === undefined) { n = `n${counter++}`; nameOfRoot.set(r, n); }
    return n;
  };

  // 5. build elements
  const elements: Element[] = [];
  const nodes = new Set<string>();
  const memberCount = new Map<string, number>();
  for (const pk of pinKeys) {
    const r = uf.find(pk.k);
    memberCount.set(r, (memberCount.get(r) ?? 0) + 1);
  }
  for (const w of circuit.wires) {
    for (const p of [w.from, w.to]) {
      const r = uf.find(key(p));
      memberCount.set(r, (memberCount.get(r) ?? 0) + 1);
    }
  }

  for (const part of circuit.parts) {
    if (part.type === 'GND') continue;
    const pins = pinPositions(part);
    const nodeNames = pins.map((p) => nameOf(uf.find(key(p))));
    nodeNames.forEach((n) => nodes.add(n));
    const values: Record<string, number> = {};
    const opts: Record<string, string> = {};
    for (const [k, raw] of Object.entries(part.params ?? {})) {
      if (STRING_PARAMS.has(k)) { opts[k] = raw; continue; }
      try {
        values[k] = parseValue(raw);
      } catch (e) {
        diagnostics.push({ severity: 'error', message: `${part.id}: ${(e as Error).message}`, ids: [part.id] });
      }
    }
    const el: Element = { id: part.id, type: part.type as ElementType, nodes: nodeNames, values, opts };
    if (opts.ctrlA !== undefined && opts.ctrlB !== undefined) el.ctrlNodes = [opts.ctrlA, opts.ctrlB];
    elements.push(el);
  }
  nodes.add(GROUND);

  // 6. red-pin check: a pin alone at its point is unconnected
  for (const pk of pinKeys) {
    if (pk.type === 'GND') continue;
    const r = uf.find(pk.k);
    if ((memberCount.get(r) ?? 0) <= 1) {
      diagnostics.push({ severity: 'error', message: `${pk.part} has a pin that isn't wired to anything.`, ids: [pk.part] });
    }
  }

  const nodeOfPoint = new Map<string, string>();
  for (const pk of pinKeys) nodeOfPoint.set(pk.k, nameOf(uf.find(pk.k)));
  for (const w of circuit.wires) for (const p of [w.from, w.to]) nodeOfPoint.set(key(p), nameOf(uf.find(key(p))));

  const nodeAtPoint = (p: Point): string | undefined => {
    const r = rootOfPoint(p);
    return r ? nameOf(r) : undefined;
  };

  // Keep node order stable: ground first, then in order of first use.
  const ordered = [GROUND, ...[...nodes].filter((n) => n !== GROUND)];
  return { netlist: { elements, nodes: ordered }, nodeOfPoint, nodeAtPoint, diagnostics };
}

/** Parse the analysis block of a circuit file into engine units. */
export function parseAnalysis(a: Circuit['analysis']): import('../engine/netlist').AnalysisSpec {
  switch (a.kind) {
    case 'dc': return { kind: 'dc' };
    case 'tran': return { kind: 'tran', tEnd: parseValue(a.tEnd), dt: a.dt ? parseValue(a.dt) : undefined };
    case 'ac': return {
      kind: 'ac', fStart: parseValue(a.fStart), fStop: parseValue(a.fStop),
      pointsPerDecade: a.pointsPerDecade ?? 100, log: a.log ?? true,
    };
  }
}
