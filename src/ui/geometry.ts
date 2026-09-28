/** Geometry helpers for the canvas: snapping, hit-testing, junction dots, unconnected pins. */
import { key, pinPositions, pointOnSegment, type Circuit, type Part, type Point, type Wire } from '../schematic/model';

export const GRID = 10;

export function snap(v: number, grid = GRID): number {
  return Math.round(v / grid) * grid;
}

export function snapPoint(p: Point, grid = GRID): Point {
  return [snap(p[0], grid), snap(p[1], grid)];
}

export function distToSegment(p: Point, a: Point, b: Point): number {
  const [px, py] = p, [ax, ay] = a, [bx, by] = b;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Rough bounding box of a part's body for hit-testing and marquee selection. */
export function partBox(part: Part): { x: number; y: number; w: number; h: number } {
  const pins = pinPositions(part);
  let minX = part.x, maxX = part.x, minY = part.y, maxY = part.y;
  for (const p of pins) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  const pad = part.type === 'OPAMP' ? 10 : part.type === 'GND' ? 8 : 7;
  return { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };
}

export function pointInBox(p: Point, b: { x: number; y: number; w: number; h: number }): boolean {
  return p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h;
}

export type Hit =
  | { kind: 'pin'; part: Part; pin: string; at: Point }
  | { kind: 'probe'; id: string; handle: 'node' | 'ref' }
  | { kind: 'part'; part: Part }
  | { kind: 'wire'; wire: Wire }
  | { kind: 'empty' };

/** What is under a world-space point? Pins beat probes beat parts beat wires. */
export function hitTest(c: Circuit, p: Point, tolerance = 6): Hit {
  for (const part of c.parts) {
    for (const pin of pinPositions(part)) {
      if (Math.hypot(pin.x - p[0], pin.y - p[1]) <= tolerance) return { kind: 'pin', part, pin: pin.name, at: [pin.x, pin.y] };
    }
  }
  for (const pr of c.probes) {
    if (pr.refAt && Math.hypot(pr.refAt[0] - p[0], pr.refAt[1] - p[1]) <= tolerance + 2) return { kind: 'probe', id: pr.id, handle: 'ref' };
    if (pr.nodeAt && Math.hypot(pr.nodeAt[0] - p[0], pr.nodeAt[1] - p[1]) <= tolerance + 2) return { kind: 'probe', id: pr.id, handle: 'node' };
  }
  for (let i = c.parts.length - 1; i >= 0; i--) {
    const part = c.parts[i];
    if (pointInBox(p, partBox(part))) return { kind: 'part', part };
  }
  for (const w of c.wires) if (distToSegment(p, w.from, w.to) <= tolerance) return { kind: 'wire', wire: w };
  return { kind: 'empty' };
}

/** Is there a wire or pin exactly at this grid point (so a wire being drawn should stop here)? */
export function isConnectionPoint(c: Circuit, p: Point, ignoreWire?: Wire): boolean {
  for (const part of c.parts) for (const pin of pinPositions(part)) if (pin.x === p[0] && pin.y === p[1]) return true;
  for (const w of c.wires) if (w !== ignoreWire && pointOnSegment(p, w.from, w.to)) return true;
  return false;
}

/** Points that should be drawn with a junction dot. */
export function junctionPoints(c: Circuit): Point[] {
  const count = new Map<string, { p: Point; n: number }>();
  const bump = (p: Point, n = 1) => {
    const k = key(p);
    const e = count.get(k);
    if (e) e.n += n; else count.set(k, { p, n });
  };
  for (const w of c.wires) { bump(w.from); bump(w.to); }
  const pinCount = new Map<string, number>();
  for (const part of c.parts) {
    if (part.type === 'GND') continue;
    for (const pin of pinPositions(part)) {
      const k = key(pin);
      pinCount.set(k, (pinCount.get(k) ?? 0) + 1);
      bump([pin.x, pin.y]);
    }
  }
  const out: Point[] = [];
  for (const [k, e] of count) {
    // 3+ things meeting, or two pins touching with no wire (SPEC §9.1)
    if (e.n >= 3 || (pinCount.get(k) ?? 0) >= 2) out.push(e.p);
  }
  // wire endpoint on the interior of another wire (T-junction)
  for (const w of c.wires) {
    for (const p of [w.from, w.to]) {
      for (const o of c.wires) {
        if (o === w) continue;
        if (pointOnSegment(p, o.from, o.to) && key(p) !== key(o.from) && key(p) !== key(o.to)) {
          if (!out.some((q) => q[0] === p[0] && q[1] === p[1])) out.push(p);
        }
      }
    }
  }
  return out;
}

/** "partId:pinName" for every pin that touches nothing. Drawn red. */
export function unconnectedPins(c: Circuit): Set<string> {
  const pts = new Map<string, number>();
  const bump = (k: string) => pts.set(k, (pts.get(k) ?? 0) + 1);
  for (const w of c.wires) { bump(key(w.from)); bump(key(w.to)); }
  const pins: { id: string; k: string; p: Point }[] = [];
  for (const part of c.parts) for (const pin of pinPositions(part)) { const k = key(pin); pins.push({ id: `${part.id}:${pin.name}`, k, p: [pin.x, pin.y] }); bump(k); }
  const out = new Set<string>();
  for (const pin of pins) {
    if ((pts.get(pin.k) ?? 0) >= 2) continue;
    // a pin lying on the interior of a wire does NOT connect (SPEC §7.3), so only exact hits count
    out.add(pin.id);
  }
  return out;
}

export function circuitBounds(c: Circuit): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x: number, y: number) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  for (const part of c.parts) { const b = partBox(part); add(b.x, b.y); add(b.x + b.w, b.y + b.h); }
  for (const w of c.wires) { add(...w.from); add(...w.to); }
  for (const pr of c.probes) { if (pr.nodeAt) add(...pr.nodeAt); if (pr.refAt) add(...pr.refAt); }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** The lowest drawn point (largest y) — where "Add ground" puts the ground symbol. */
export function lowestPoint(c: Circuit): Point | null {
  let best: Point | null = null;
  const consider = (p: Point) => { if (!best || p[1] > best[1] || (p[1] === best[1] && p[0] < best[0])) best = p; };
  for (const w of c.wires) { consider(w.from); consider(w.to); }
  for (const part of c.parts) for (const pin of pinPositions(part)) consider([pin.x, pin.y]);
  return best;
}
