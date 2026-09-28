/**
 * Editor state and reducer. Every change to the circuit goes through here so
 * undo/redo is uniform: a snapshot of the circuit is pushed before each edit.
 */
import type { Circuit, Part, PartType, Point, Probe, Rotation, Wire } from '../schematic/model';
import { pinPositions } from '../schematic/model';
import { hitTest } from './geometry';

export interface Selection { parts: string[]; wires: string[]; probes: string[] }
export const EMPTY_SELECTION: Selection = { parts: [], wires: [], probes: [] };

export type Tool =
  | { kind: 'select' }
  | { kind: 'place'; type: PartType; rot: Rotation; flip: boolean }
  | { kind: 'wire'; points: Point[] }
  | { kind: 'probe'; probeKind: 'v' | 'i' | 'p' };

export interface EditorState {
  circuit: Circuit;
  selection: Selection;
  tool: Tool;
  past: string[];
  future: string[];
  /** bumps on each committed edit so autosave / live-rerun can react */
  rev: number;
}

export const DEFAULT_PARAMS: Record<PartType, Record<string, string> | undefined> = {
  R: { R: '1k' }, C: { C: '1u' }, L: { L: '1m' }, GND: undefined,
  Vdc: { V: '5' }, Idc: { I: '1m' },
  Vwave: { type: 'pulse', v1: '0', v2: '1', td: '0', tr: '1u', tf: '1u', pw: '1m', per: '2m', acMag: '1', acPhase: '0' },
  VCVS: { gain: '2', ctrl: '' }, VCCS: { gain: '1m', ctrl: '' }, CCVS: { gain: '10', ctrl: '' }, CCCS: { gain: '2', ctrl: '' },
  OPAMP: undefined, SW: { init: 'closed', toggle: 'true' },
};

const PREFIX: Record<PartType, string> = {
  R: 'R', C: 'C', L: 'L', GND: 'GND', Vdc: 'V', Idc: 'I', Vwave: 'V',
  VCVS: 'E', VCCS: 'Gm', CCVS: 'H', CCCS: 'F', OPAMP: 'OA', SW: 'S',
};

export function nextId(c: Circuit, type: PartType): string {
  const prefix = PREFIX[type];
  const used = new Set(c.parts.map((p) => p.id));
  for (let n = 1; ; n++) if (!used.has(`${prefix}${n}`)) return `${prefix}${n}`;
}

let wireCounter = 1;
export function withWireIds(c: Circuit): Circuit {
  return { ...c, wires: c.wires.map((w) => (w.id ? w : { ...w, id: `w${wireCounter++}` })) };
}

export function blankCircuit(): Circuit {
  return { v: 1, grid: 10, parts: [], wires: [], probes: [], analysis: { kind: 'dc' }, labels: [] };
}

export function initialState(circuit: Circuit = blankCircuit()): EditorState {
  return { circuit: withWireIds(circuit), selection: EMPTY_SELECTION, tool: { kind: 'select' }, past: [], future: [], rev: 0 };
}

export type Action =
  | { type: 'load'; circuit: Circuit }
  | { type: 'setTool'; tool: Tool }
  | { type: 'select'; selection: Selection }
  | { type: 'addPart'; part: Part }
  | { type: 'addWires'; wires: Wire[] }
  | { type: 'addProbe'; probe: Probe }
  | { type: 'updateProbe'; id: string; patch: Partial<Probe> }
  | { type: 'setParam'; id: string; name: string; value: string }
  | { type: 'setParams'; id: string; params: Record<string, string> }
  | { type: 'moveSelection'; dx: number; dy: number; snapshot?: string }
  | { type: 'rotateSelection' }
  | { type: 'flipSelection' }
  | { type: 'deleteSelection' }
  | { type: 'setAnalysis'; analysis: Circuit['analysis'] }
  | { type: 'undo' }
  | { type: 'redo' };

function snapshot(c: Circuit): string {
  return JSON.stringify(c);
}

function commit(s: EditorState, circuit: Circuit, snap?: string): EditorState {
  return { ...s, circuit, past: [...s.past, snap ?? snapshot(s.circuit)], future: [], rev: s.rev + 1 };
}

export function isSelected(sel: Selection, hit: ReturnType<typeof hitTest>): boolean {
  if (hit.kind === 'part' || hit.kind === 'pin') return sel.parts.includes(hit.part.id);
  if (hit.kind === 'wire') return !!hit.wire.id && sel.wires.includes(hit.wire.id);
  if (hit.kind === 'probe') return sel.probes.includes(hit.id);
  return false;
}

export function reducer(s: EditorState, a: Action): EditorState {
  switch (a.type) {
    case 'load':
      return { ...initialState(a.circuit), past: [...s.past, snapshot(s.circuit)], rev: s.rev + 1 };
    case 'setTool':
      return { ...s, tool: a.tool };
    case 'select':
      return { ...s, selection: a.selection };
    case 'addPart':
      return commit(s, { ...s.circuit, parts: [...s.circuit.parts, a.part] });
    case 'addWires': {
      const wires = a.wires.filter((w) => w.from[0] !== w.to[0] || w.from[1] !== w.to[1]).map((w) => ({ ...w, id: w.id ?? `w${wireCounter++}` }));
      if (!wires.length) return s;
      return commit(s, { ...s.circuit, wires: [...s.circuit.wires, ...wires] });
    }
    case 'addProbe':
      return { ...commit(s, { ...s.circuit, probes: [...s.circuit.probes, a.probe] }), selection: { parts: [], wires: [], probes: [a.probe.id] } };
    case 'updateProbe':
      return commit(s, { ...s.circuit, probes: s.circuit.probes.map((p) => (p.id === a.id ? { ...p, ...a.patch } : p)) });
    case 'setParam':
      return commit(s, { ...s.circuit, parts: s.circuit.parts.map((p) => (p.id === a.id ? { ...p, params: { ...(p.params ?? {}), [a.name]: a.value } } : p)) });
    case 'setParams':
      return commit(s, { ...s.circuit, parts: s.circuit.parts.map((p) => (p.id === a.id ? { ...p, params: a.params } : p)) });
    case 'moveSelection': {
      if (a.dx === 0 && a.dy === 0) return s;
      const sel = s.selection;
      const movedPins = new Set<string>();
      for (const p of s.circuit.parts) if (sel.parts.includes(p.id)) for (const pin of pinPositions(p)) movedPins.add(`${pin.x},${pin.y}`);
      const mv = (pt: Point): Point => [pt[0] + a.dx, pt[1] + a.dy];
      const parts = s.circuit.parts.map((p) => (sel.parts.includes(p.id) ? { ...p, x: p.x + a.dx, y: p.y + a.dy } : p));
      // wires: selected ones move whole; others follow a moved pin at their endpoint (rubber band)
      const wires = s.circuit.wires.map((w) => {
        if (w.id && sel.wires.includes(w.id)) return { ...w, from: mv(w.from), to: mv(w.to) };
        const from = movedPins.has(`${w.from[0]},${w.from[1]}`) ? mv(w.from) : w.from;
        const to = movedPins.has(`${w.to[0]},${w.to[1]}`) ? mv(w.to) : w.to;
        return from === w.from && to === w.to ? w : { ...w, from, to };
      });
      const probes = s.circuit.probes.map((p) => {
        if (!sel.probes.includes(p.id)) return p;
        return { ...p, nodeAt: p.nodeAt ? mv(p.nodeAt) : p.nodeAt, refAt: p.refAt ? mv(p.refAt) : p.refAt };
      });
      return commit(s, { ...s.circuit, parts, wires, probes }, a.snapshot);
    }
    case 'rotateSelection': {
      if (!s.selection.parts.length) return s;
      const parts = s.circuit.parts.map((p) => (s.selection.parts.includes(p.id) ? { ...p, rot: (((p.rot ?? 0) + 90) % 360) as Rotation } : p));
      return commit(s, { ...s.circuit, parts });
    }
    case 'flipSelection': {
      if (!s.selection.parts.length) return s;
      const parts = s.circuit.parts.map((p) => (s.selection.parts.includes(p.id) ? { ...p, flip: !p.flip } : p));
      return commit(s, { ...s.circuit, parts });
    }
    case 'deleteSelection': {
      const sel = s.selection;
      if (!sel.parts.length && !sel.wires.length && !sel.probes.length) return s;
      const parts = s.circuit.parts.filter((p) => !sel.parts.includes(p.id));
      const wires = s.circuit.wires.filter((w) => !(w.id && sel.wires.includes(w.id)));
      const probes = s.circuit.probes.filter((p) => !sel.probes.includes(p.id) && !(p.element && sel.parts.includes(p.element)));
      return { ...commit(s, { ...s.circuit, parts, wires, probes }), selection: EMPTY_SELECTION };
    }
    case 'setAnalysis':
      return commit(s, { ...s.circuit, analysis: a.analysis });
    case 'undo': {
      if (!s.past.length) return s;
      const prev = s.past[s.past.length - 1];
      return { ...s, circuit: withWireIds(JSON.parse(prev)), past: s.past.slice(0, -1), future: [snapshot(s.circuit), ...s.future], selection: EMPTY_SELECTION, rev: s.rev + 1 };
    }
    case 'redo': {
      if (!s.future.length) return s;
      const next = s.future[0];
      return { ...s, circuit: withWireIds(JSON.parse(next)), past: [...s.past, snapshot(s.circuit)], future: s.future.slice(1), selection: EMPTY_SELECTION, rev: s.rev + 1 };
    }
  }
}

export function nextProbeId(c: Circuit): string {
  const used = new Set(c.probes.map((p) => p.id));
  for (let n = 1; ; n++) if (!used.has(`P${n}`)) return `P${n}`;
}

/** Letter shown on a probe badge: A, B, C ... in creation order. */
export function probeLetter(c: Circuit, id: string): string {
  const idx = c.probes.findIndex((p) => p.id === id);
  return String.fromCharCode(65 + (idx % 26));
}

export const PROBE_COLORS = ['#c2410c', '#1d4ed8', '#15803d', '#7e22ce', '#b45309', '#0e7490', '#be123c', '#4d7c0f'];
export function probeColor(c: Circuit, id: string): string {
  const idx = c.probes.findIndex((p) => p.id === id);
  return PROBE_COLORS[(idx < 0 ? 0 : idx) % PROBE_COLORS.length];
}
