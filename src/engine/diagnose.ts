/**
 * Pre-solve structural checks (SPEC §7.1). Messages are for students.
 * Returns a list; anything with severity 'error' blocks the run.
 */
import { GROUND, type Element, type Netlist } from './netlist';
import { switchClosed } from './mna';

export type Severity = 'error' | 'warn' | 'note';
export interface Diagnostic { severity: Severity; message: string; ids: string[] }

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    let p = this.parent.get(x);
    if (p === undefined) { this.parent.set(x, x); return x; }
    if (p !== x) { p = this.find(p); this.parent.set(x, p); }
    return p;
  }
  union(a: string, b: string): boolean {
    const ra = this.find(a), rb = this.find(b);
    if (ra === rb) return false;
    this.parent.set(ra, rb);
    return true;
  }
}

function pinCount(nl: Netlist): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of nl.elements) for (const n of e.nodes) m.set(n, (m.get(n) ?? 0) + 1);
  return m;
}

function pinName(e: Element, idx: number): string {
  if (e.type === 'OPAMP') return ['+', '−', 'output'][idx] ?? '';
  if (e.type === 'Vdc' || e.type === 'Vwave' || e.type === 'Idc' || e.type.endsWith('S')) return idx === 0 ? '+' : '−';
  return idx === 0 ? 'left/top' : 'right/bottom';
}

export function diagnose(nl: Netlist, analysis: 'dc' | 'tran' | 'ac' = 'dc'): Diagnostic[] {
  const out: Diagnostic[] = [];
  const ids = elementsByIdWithDupes(nl, out);

  // ground
  const touchesGround = nl.elements.some((e) => e.nodes.includes(GROUND));
  if (!touchesGround) out.push({ severity: 'error', message: 'Add a ground so voltages have a reference.', ids: [] });

  // unconnected pins (a node touched by exactly one pin)
  const counts = pinCount(nl);
  for (const e of nl.elements) {
    e.nodes.forEach((n, idx) => {
      if (n !== GROUND && counts.get(n) === 1) {
        const what = e.type === 'OPAMP'
          ? `The ${pinName(e, idx)} input of ${e.id} isn't connected.`
          : `${e.id} has a pin that isn't wired to anything.`;
        out.push({ severity: 'error', message: e.type === 'OPAMP' && idx === 2 ? `${e.id}'s output isn't connected.` : what, ids: [e.id] });
      }
    });
  }

  // values
  for (const e of nl.elements) {
    if (e.type === 'R' && !(e.values.R > 0)) out.push({ severity: 'error', message: `${e.id}'s resistance must be greater than zero.`, ids: [e.id] });
    if (e.type === 'C' && !(e.values.C > 0)) out.push({ severity: 'error', message: `${e.id}'s capacitance must be greater than zero.`, ids: [e.id] });
    if (e.type === 'L' && !(e.values.L > 0)) out.push({ severity: 'error', message: `${e.id}'s inductance must be greater than zero.`, ids: [e.id] });
  }

  // dependent sources whose control element is gone
  for (const e of nl.elements) {
    if (e.type === 'VCVS' || e.type === 'VCCS' || e.type === 'CCVS' || e.type === 'CCCS') {
      if (!e.ctrlNodes && !(e.opts.ctrl && ids.has(e.opts.ctrl))) {
        out.push({ severity: 'error', message: `${e.id} was controlled by ${e.opts.ctrl ?? '(nothing)'}, which no longer exists.`, ids: [e.id] });
      }
    }
  }

  // voltage-source loops: elements that force a voltage between their nodes
  const isDcShort = (e: Element): boolean => {
    switch (e.type) {
      case 'Vdc': case 'Vwave': case 'VCVS': case 'CCVS': return true;
      case 'L': return analysis === 'dc';
      case 'SW': return switchClosed(e, 'init');
      default: return false;
    }
  };
  {
    const uf = new UnionFind();
    const seen: Element[] = [];
    for (const e of nl.elements) {
      if (e.type === 'OPAMP') {
        if (!uf.union(e.nodes[2], GROUND)) {
          out.push({ severity: 'error', message: `${e.id}'s output is wired directly across a voltage source, ground, or another op amp — no circuit can satisfy that. Add a resistor.`, ids: [e.id, ...seen.map((s) => s.id)] });
        }
        seen.push(e);
        continue;
      }
      if (!isDcShort(e)) continue;
      if (!uf.union(e.nodes[0], e.nodes[1])) {
        const others = seen.filter((s) => uf.find(s.nodes[0]) === uf.find(e.nodes[0])).map((s) => s.id);
        const who = others.length ? `${e.id} and ${others.join(', ')} are` : `${e.id} is`;
        out.push({
          severity: 'error',
          message: `${who} wired directly in parallel (or shorted) — no circuit can satisfy that. Add a resistor or remove one.`,
          ids: [e.id, ...others],
        });
      }
      seen.push(e);
    }
  }

  // current source with nowhere to go: no other path between its two nodes
  for (const e of nl.elements) {
    if (e.type !== 'Idc' && e.type !== 'VCCS' && e.type !== 'CCCS') continue;
    const uf = new UnionFind();
    for (const o of nl.elements) {
      if (o === e) continue;
      for (let k = 1; k < o.nodes.length; k++) uf.union(o.nodes[0], o.nodes[k]);
    }
    if (uf.find(e.nodes[0]) !== uf.find(e.nodes[1])) {
      out.push({ severity: 'error', message: `${e.id}'s current has nowhere to go.`, ids: [e.id] });
    }
  }

  // nodes with no DC path to ground (only through capacitors / current sources)
  {
    const uf = new UnionFind();
    uf.find(GROUND);
    for (const e of nl.elements) {
      if (e.type === 'C' || e.type === 'Idc' || e.type === 'VCCS' || e.type === 'CCCS') continue;
      if (e.type === 'SW' && !switchClosed(e, 'init')) continue;
      if (e.type === 'OPAMP') { uf.union(e.nodes[2], GROUND); continue; }
      uf.union(e.nodes[0], e.nodes[1]);
    }
    const floating = nl.nodes.filter((n) => n !== GROUND && uf.find(n) !== uf.find(GROUND));
    for (const n of floating) {
      const via = nl.elements.filter((e) => e.nodes.includes(n)).map((e) => e.id);
      out.push({
        severity: 'note',
        message: `Node ${n} (between ${via.join(' and ')}) has no DC path to ground; its DC voltage is undefined (that's fine for Time/Frequency).`,
        ids: via,
      });
    }
  }

  return out;
}

function elementsByIdWithDupes(nl: Netlist, out: Diagnostic[]): Set<string> {
  const seen = new Set<string>();
  for (const e of nl.elements) {
    if (seen.has(e.id)) out.push({ severity: 'warn', message: `Two parts are both called ${e.id}.`, ids: [e.id] });
    seen.add(e.id);
  }
  return seen;
}

export function hasErrors(d: Diagnostic[]): boolean {
  return d.some((x) => x.severity === 'error');
}
