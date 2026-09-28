/**
 * Drawing model: parts, pins, wires on an integer grid (SPEC §5).
 * Pin positions come from a per-type pin table plus the part's x, y, rot.
 */
import type { ElementType } from '../engine/netlist';

export type PartType = ElementType | 'GND';
export type Rotation = 0 | 90 | 180 | 270;
export type Point = [number, number];

export interface Part {
  id: string;
  type: PartType;
  x: number;
  y: number;
  rot: Rotation;
  params?: Record<string, string>;
}

export interface Wire { from: Point; to: Point }

export interface Probe {
  id: string;
  kind: 'v' | 'i' | 'p';
  nodeAt?: Point;
  refAt?: Point;
  element?: string;
  label?: string;
}

export interface Label { at: Point; text: string }

export type AnalysisJson =
  | { kind: 'dc' }
  | { kind: 'tran'; tEnd: string; dt?: string }
  | { kind: 'ac'; fStart: string; fStop: string; pointsPerDecade?: number; log?: boolean };

export interface Circuit {
  v: 1;
  grid: number;
  parts: Part[];
  wires: Wire[];
  probes: Probe[];
  analysis: AnalysisJson;
  labels: Label[];
}

export interface PinDef { name: string; dx: number; dy: number }

/** Pin offsets at rotation 0. Two-terminal parts lie horizontally, pin "a" on the left. */
const TWO: PinDef[] = [{ name: 'a', dx: -20, dy: 0 }, { name: 'b', dx: 20, dy: 0 }];

export const PIN_TABLE: Record<PartType, PinDef[]> = {
  R: TWO, C: TWO, L: TWO, Vdc: TWO, Idc: TWO, Vwave: TWO, SW: TWO,
  VCVS: TWO, VCCS: TWO, CCVS: TWO, CCCS: TWO,
  GND: [{ name: 'g', dx: 0, dy: 0 }],
  OPAMP: [{ name: 'plus', dx: -30, dy: -10 }, { name: 'minus', dx: -30, dy: 10 }, { name: 'out', dx: 30, dy: 0 }],
};

/** Rotate an offset clockwise on screen (y grows downward) by rot degrees. */
export function rotate(dx: number, dy: number, rot: Rotation): Point {
  switch (rot) {
    case 0: return [dx, dy];
    case 90: return [-dy, dx];
    case 180: return [-dx, -dy];
    case 270: return [dy, -dx];
  }
}

export interface PinPos { name: string; x: number; y: number }

export function pinPositions(part: Part): PinPos[] {
  const defs = PIN_TABLE[part.type];
  if (!defs) throw new Error(`Unknown part type "${part.type}" on ${part.id}.`);
  return defs.map((d) => {
    const [rx, ry] = rotate(d.dx, d.dy, part.rot ?? 0);
    return { name: d.name, x: part.x + rx, y: part.y + ry };
  });
}

export function key(p: Point | { x: number; y: number }): string {
  return Array.isArray(p) ? `${p[0]},${p[1]}` : `${p.x},${p.y}`;
}

/** Is point p on the segment from a to b (inclusive of the ends)? Segments are orthogonal. */
export function pointOnSegment(p: Point, a: Point, b: Point): boolean {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  if (ax === bx && ay === by) return px === ax && py === ay;
  const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  if (cross !== 0) return false;
  return px >= Math.min(ax, bx) && px <= Math.max(ax, bx) && py >= Math.min(ay, by) && py <= Math.max(ay, by);
}
