/**
 * The schematic canvas (SVG). Direct manipulation: place, wire, select, drag,
 * marquee, probes, inline value editing. Pan with space-drag / middle mouse,
 * zoom with the wheel.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from 'react';
import { pinPositions, pointOnSegment, type Part, type Point, type Probe, type Wire } from '../schematic/model';
import { GRID, circuitBounds, distToSegment, hitTest, isConnectionPoint, junctionPoints, partBox, pointInBox, snapPoint, unconnectedPins } from './geometry';
import { nextId, nextProbeId, probeColor, probeLetter, type Action, type EditorState, type Selection, DEFAULT_PARAMS } from './state';
import { Symbol, displayValue, mainParam } from './symbols';

export interface ProbeReadout { text: string; tooltip: string }

export interface CanvasProps {
  state: EditorState;
  dispatch: (a: Action) => void;
  readouts: Record<string, ProbeReadout>;
  highlight: Set<string>;
  /** hover text per part id after a run ("V = 1.63 V, I = 87 mA") */
  partInfo: Record<string, string>;
  fitRequest: number;
  spaceHeld: boolean;
}

interface View { x: number; y: number; scale: number }

type Drag =
  | { kind: 'pan'; startClient: Point; startView: View }
  | { kind: 'move'; start: Point; offset: Point; moved: boolean }
  | { kind: 'marquee'; start: Point; current: Point; additive: boolean }
  | { kind: 'wire'; start: Point; current: Point }
  | { kind: 'probeHandle'; id: string; handle: 'node' | 'ref'; current: Point };

const REF_HANDLE_OFFSET: Point = [14, 14];

function lRoute(a: Point, b: Point): Wire[] {
  if (a[0] === b[0] || a[1] === b[1]) return [{ from: a, to: b }];
  const corner: Point = [b[0], a[1]];
  return [{ from: a, to: corner }, { from: corner, to: b }];
}

/** Snap a point onto the nearest grid point that lies on the given wire. */
function snapOntoWire(p: Point, w: Wire): Point {
  const s = snapPoint(p);
  if (pointOnSegment(s, w.from, w.to)) return s;
  // project then clamp to the wire's grid points
  const [ax, ay] = w.from, [bx, by] = w.to;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2));
  return snapPoint([ax + t * dx, ay + t * dy]);
}

export function Canvas({ state, dispatch, readouts, highlight, partInfo, fitRequest, spaceHeld }: CanvasProps) {
  const { circuit, selection, tool } = state;
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>({ x: -20, y: -20, scale: 1.6 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [edit, setEdit] = useState<{ id: string; param: string; value: string } | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const stateRef = useRef(state);
  stateRef.current = state;

  const toWorld = useCallback((clientX: number, clientY: number): Point => {
    const r = svgRef.current!.getBoundingClientRect();
    return [(clientX - r.left) / view.scale + view.x, (clientY - r.top) / view.scale + view.y];
  }, [view]);

  // fit-to-circuit
  useEffect(() => {
    if (!fitRequest) return;
    const b = circuitBounds(circuit);
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    if (!b) { setView({ x: -20, y: -20, scale: 1.6 }); return; }
    const scale = Math.min(3, Math.max(0.3, Math.min(r.width / (b.w + 80), r.height / (b.h + 80))));
    setView({ x: b.x + b.w / 2 - r.width / scale / 2, y: b.y + b.h / 2 - r.height / scale / 2, scale });
  }, [fitRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  const unconnected = unconnectedPins(circuit);
  const junctions = junctionPoints(circuit);

  const refHandlePos = (p: Probe): Point | null => {
    if (p.kind !== 'v' || !p.nodeAt) return null;
    return p.refAt ?? [p.nodeAt[0] + REF_HANDLE_OFFSET[0], p.nodeAt[1] + REF_HANDLE_OFFSET[1]];
  };

  function finishWire(from: Point, to: Point) {
    dispatch({ type: 'addWires', wires: lRoute(from, to) });
  }

  function placeProbe(kind: 'v' | 'i' | 'p', p: Point) {
    const hit = hitTest(circuit, p);
    const id = nextProbeId(circuit);
    if (kind === 'v') {
      let at: Point | null = null;
      if (hit.kind === 'pin') at = hit.at;
      else if (hit.kind === 'wire') at = snapOntoWire(p, hit.wire);
      else if (hit.kind === 'part') {
        const pins = pinPositions(hit.part);
        const near = pins.reduce((b, q) => (Math.hypot(q.x - p[0], q.y - p[1]) < Math.hypot(b.x - p[0], b.y - p[1]) ? q : b));
        at = [near.x, near.y];
      }
      if (!at) return;
      dispatch({ type: 'addProbe', probe: { id, kind: 'v', nodeAt: at } });
    } else {
      const part = hit.kind === 'part' || hit.kind === 'pin' ? hit.part : null;
      if (!part || part.type === 'GND' || part.type === 'OPAMP') return;
      dispatch({ type: 'addProbe', probe: { id, kind, element: part.id, dir: 1 } });
    }
    dispatch({ type: 'setTool', tool: { kind: 'select' } });
  }

  function onPointerDown(e: RPointerEvent<SVGSVGElement>) {
    if (edit) return;
    const p = toWorld(e.clientX, e.clientY);
    const sp = snapPoint(p);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (e.button === 1 || (e.button === 0 && spaceHeld)) {
      setDrag({ kind: 'pan', startClient: [e.clientX, e.clientY], startView: view });
      return;
    }
    if (e.button === 2) {
      if (tool.kind !== 'select') dispatch({ type: 'setTool', tool: { kind: 'select' } });
      return;
    }
    if (e.button !== 0) return;
    svgRef.current?.focus();

    if (tool.kind === 'place') {
      const part: Part = { id: nextId(circuit, tool.type), type: tool.type, x: sp[0], y: sp[1], rot: tool.rot, params: DEFAULT_PARAMS[tool.type] ? { ...DEFAULT_PARAMS[tool.type] } : undefined };
      if (tool.flip) part.flip = true;
      dispatch({ type: 'addPart', part });
      dispatch({ type: 'select', selection: { parts: [part.id], wires: [], probes: [] } });
      dispatch({ type: 'setTool', tool: { kind: 'select' } });
      return;
    }
    if (tool.kind === 'wire') {
      if (tool.points.length === 0) { dispatch({ type: 'setTool', tool: { kind: 'wire', points: [sp] } }); return; }
      const last = tool.points[tool.points.length - 1];
      if (last[0] === sp[0] && last[1] === sp[1]) { dispatch({ type: 'setTool', tool: { kind: 'wire', points: [] } }); return; }
      finishWire(last, sp);
      const stop = isConnectionPoint(circuit, sp);
      dispatch({ type: 'setTool', tool: { kind: 'wire', points: stop ? [] : [sp] } });
      return;
    }
    if (tool.kind === 'probe') { placeProbe(tool.probeKind, p); return; }

    // ---- select tool ----
    // probe reference handles first (they float next to the probe)
    for (const pr of circuit.probes) {
      const h = refHandlePos(pr);
      if (h && Math.hypot(h[0] - p[0], h[1] - p[1]) <= 7) {
        setDrag({ kind: 'probeHandle', id: pr.id, handle: 'ref', current: sp });
        dispatch({ type: 'select', selection: { parts: [], wires: [], probes: [pr.id] } });
        return;
      }
    }
    const hit = hitTest(circuit, p);
    if (hit.kind === 'pin') {
      setDrag({ kind: 'wire', start: hit.at, current: hit.at });
      return;
    }
    if (hit.kind === 'probe') {
      dispatch({ type: 'select', selection: { parts: [], wires: [], probes: [hit.id] } });
      setDrag({ kind: 'probeHandle', id: hit.id, handle: hit.handle, current: sp });
      return;
    }
    if (hit.kind === 'part' || hit.kind === 'wire') {
      const id = hit.kind === 'part' ? hit.part.id : hit.wire.id!;
      const listKey = hit.kind === 'part' ? 'parts' : 'wires';
      let sel: Selection = selection;
      const already = selection[listKey].includes(id);
      if (e.shiftKey) {
        sel = { ...selection, [listKey]: already ? selection[listKey].filter((x) => x !== id) : [...selection[listKey], id] };
      } else if (!already) {
        sel = { parts: [], wires: [], probes: [], [listKey]: [id] } as Selection;
      }
      dispatch({ type: 'select', selection: sel });
      if (!e.shiftKey) setDrag({ kind: 'move', start: sp, offset: [0, 0], moved: false });
      return;
    }
    setDrag({ kind: 'marquee', start: p, current: p, additive: e.shiftKey });
  }

  function onPointerMove(e: RPointerEvent<SVGSVGElement>) {
    const p = toWorld(e.clientX, e.clientY);
    setCursor(p);
    const d = dragRef.current;
    if (!d) return;
    switch (d.kind) {
      case 'pan': {
        const dx = (e.clientX - d.startClient[0]) / d.startView.scale;
        const dy = (e.clientY - d.startClient[1]) / d.startView.scale;
        setView({ ...d.startView, x: d.startView.x - dx, y: d.startView.y - dy });
        break;
      }
      case 'move': {
        const sp = snapPoint(p);
        const off: Point = [sp[0] - d.start[0], sp[1] - d.start[1]];
        if (off[0] !== d.offset[0] || off[1] !== d.offset[1]) setDrag({ ...d, offset: off, moved: true });
        break;
      }
      case 'marquee': setDrag({ ...d, current: p }); break;
      case 'wire': setDrag({ ...d, current: snapPoint(p) }); break;
      case 'probeHandle': setDrag({ ...d, current: snapPoint(p) }); break;
    }
  }

  function onPointerUp(e: RPointerEvent<SVGSVGElement>) {
    const d = dragRef.current;
    if (!d) return;
    setDrag(null);
    const p = toWorld(e.clientX, e.clientY);
    switch (d.kind) {
      case 'move':
        if (d.moved) dispatch({ type: 'moveSelection', dx: d.offset[0], dy: d.offset[1] });
        break;
      case 'marquee': {
        const x0 = Math.min(d.start[0], d.current[0]), x1 = Math.max(d.start[0], d.current[0]);
        const y0 = Math.min(d.start[1], d.current[1]), y1 = Math.max(d.start[1], d.current[1]);
        if (x1 - x0 < 3 && y1 - y0 < 3) { if (!d.additive) dispatch({ type: 'select', selection: { parts: [], wires: [], probes: [] } }); break; }
        const box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
        const parts = circuit.parts.filter((pt) => pointInBox([pt.x, pt.y], box)).map((pt) => pt.id);
        const wires = circuit.wires.filter((w) => pointInBox(w.from, box) && pointInBox(w.to, box)).map((w) => w.id!);
        const probes = circuit.probes.filter((pr) => pr.nodeAt && pointInBox(pr.nodeAt, box)).map((pr) => pr.id);
        const sel: Selection = d.additive
          ? { parts: [...new Set([...selection.parts, ...parts])], wires: [...new Set([...selection.wires, ...wires])], probes: [...new Set([...selection.probes, ...probes])] }
          : { parts, wires, probes };
        dispatch({ type: 'select', selection: sel });
        break;
      }
      case 'wire': {
        const sp = snapPoint(p);
        if (sp[0] === d.start[0] && sp[1] === d.start[1]) {
          // a click on a pin: start click-to-click wiring
          dispatch({ type: 'setTool', tool: { kind: 'wire', points: [d.start] } });
        } else {
          finishWire(d.start, sp);
          if (!isConnectionPoint(circuit, sp)) dispatch({ type: 'setTool', tool: { kind: 'wire', points: [sp] } });
        }
        break;
      }
      case 'probeHandle': {
        const pr = circuit.probes.find((x) => x.id === d.id);
        if (!pr) break;
        const sp = snapPoint(p);
        const onSomething = isConnectionPoint(circuit, sp);
        if (d.handle === 'ref') {
          if (onSomething && !(pr.nodeAt && sp[0] === pr.nodeAt[0] && sp[1] === pr.nodeAt[1])) dispatch({ type: 'updateProbe', id: pr.id, patch: { refAt: sp } });
          else if (pr.refAt) dispatch({ type: 'updateProbe', id: pr.id, patch: { refAt: undefined } });
        } else if (onSomething && pr.nodeAt && (sp[0] !== pr.nodeAt[0] || sp[1] !== pr.nodeAt[1])) {
          dispatch({ type: 'updateProbe', id: pr.id, patch: { nodeAt: sp } });
        }
        break;
      }
      default: break;
    }
  }

  function onWheel(e: RWheelEvent<SVGSVGElement>) {
    const p = toWorld(e.clientX, e.clientY);
    const factor = Math.exp(-e.deltaY * 0.0015);
    const scale = Math.min(5, Math.max(0.2, view.scale * factor));
    setView({ scale, x: p[0] - (p[0] - view.x) * (view.scale / scale), y: p[1] - (p[1] - view.y) * (view.scale / scale) });
  }

  function onDoubleClick(e: React.MouseEvent<SVGSVGElement>) {
    const p = toWorld(e.clientX, e.clientY);
    const hit = hitTest(circuit, p);
    if (hit.kind === 'part' || hit.kind === 'pin') startEdit(hit.part);
  }

  function startEdit(part: Part) {
    const param = mainParam(part.type);
    if (!param) return;
    setEdit({ id: part.id, param, value: part.params?.[param] ?? '' });
    dispatch({ type: 'select', selection: { parts: [part.id], wires: [], probes: [] } });
  }

  /** Commit a value typed inline. `id` guards against a stale blur from a previous session. */
  function commitInline(id: string, param: string, value: string, then: 'close' | 'next' | 'keep') {
    const part = stateRef.current.circuit.parts.find((x) => x.id === id);
    if (part && (part.params?.[param] ?? '') !== value) dispatch({ type: 'setParam', id, name: param, value });
    if (then === 'next') {
      const editable = stateRef.current.circuit.parts.filter((x) => mainParam(x.type));
      const idx = editable.findIndex((x) => x.id === id);
      const nxt = editable[(idx + 1) % editable.length];
      if (nxt && nxt.id !== id) { startEdit(nxt); return; }
    }
    if (then !== 'keep') setEdit((e) => (e && e.id === id ? null : e));
  }

  // ---- rendering helpers ----
  const svgSize = svgRef.current?.getBoundingClientRect();
  const vw = svgSize ? svgSize.width / view.scale : 800, vh = svgSize ? svgSize.height / view.scale : 600;
  const moveOff: Point = drag?.kind === 'move' ? drag.offset : [0, 0];
  const movedParts = new Set(selection.parts);
  const movedPinKeys = new Set<string>();
  if (drag?.kind === 'move' && drag.moved) {
    for (const pt of circuit.parts) if (movedParts.has(pt.id)) for (const pin of pinPositions(pt)) movedPinKeys.add(`${pin.x},${pin.y}`);
  }
  const shift = (pt: Point, cond: boolean): Point => (cond ? [pt[0] + moveOff[0], pt[1] + moveOff[1]] : pt);

  const ghostPart: Part | null = tool.kind === 'place' && cursor ? { id: 'ghost', type: tool.type, x: snapPoint(cursor)[0], y: snapPoint(cursor)[1], rot: tool.rot, flip: tool.flip } : null;
  const wirePreview: Wire[] = (() => {
    if (drag?.kind === 'wire') return lRoute(drag.start, drag.current);
    if (tool.kind === 'wire' && tool.points.length && cursor) return lRoute(tool.points[tool.points.length - 1], snapPoint(cursor));
    return [];
  })();

  const cursorStyle = drag?.kind === 'pan' || spaceHeld ? 'grabbing' : tool.kind === 'select' ? 'default' : 'crosshair';

  // grid dots (only in view)
  const gx0 = Math.floor(view.x / GRID) * GRID, gy0 = Math.floor(view.y / GRID) * GRID;
  const gridStep = view.scale < 0.7 ? GRID * 4 : view.scale < 1.2 ? GRID * 2 : GRID;

  return (
    <svg
      ref={svgRef}
      className="canvas"
      tabIndex={0}
      viewBox={`${view.x} ${view.y} ${vw} ${vh}`}
      style={{ cursor: cursorStyle }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => setCursor(null)}
      onWheel={onWheel}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => e.preventDefault()}
    >
      <defs>
        <pattern id="grid" x={0} y={0} width={gridStep} height={gridStep} patternUnits="userSpaceOnUse">
          <circle cx={0} cy={0} r={0.8} fill="#c8ccd4" />
        </pattern>
      </defs>
      <rect x={gx0 - gridStep} y={gy0 - gridStep} width={vw + 3 * gridStep} height={vh + 3 * gridStep} fill="url(#grid)" />

      {/* wires */}
      {circuit.wires.map((w) => {
        const sel = !!w.id && selection.wires.includes(w.id);
        const from = shift(w.from, sel || movedPinKeys.has(`${w.from[0]},${w.from[1]}`));
        const to = shift(w.to, sel || movedPinKeys.has(`${w.to[0]},${w.to[1]}`));
        return <line key={w.id} x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} className={`wire${sel ? ' selected' : ''}`} />;
      })}
      {wirePreview.map((w, i) => <line key={`prev${i}`} x1={w.from[0]} y1={w.from[1]} x2={w.to[0]} y2={w.to[1]} className="wire preview" />)}

      {/* parts */}
      {circuit.parts.map((part) => {
        const sel = selection.parts.includes(part.id);
        const pos = shift([part.x, part.y], sel && drag?.kind === 'move');
        const hl = highlight.has(part.id);
        const vertical = part.rot === 90 || part.rot === 270;
        const value = displayValue(part);
        const info = partInfo[part.id];
        return (
          <g key={part.id} className={`part${sel ? ' selected' : ''}${hl ? ' highlight' : ''}`}>
            {info && <title>{info}</title>}
            <g transform={`translate(${pos[0]} ${pos[1]}) rotate(${part.rot ?? 0}) scale(${part.flip ? -1 : 1} 1)`}>
              <Symbol part={part} />
            </g>
            {part.type !== 'GND' && (
              vertical
                ? <text className="label" x={pos[0] + 16} y={pos[1] - 3}>{part.id}</text>
                : <text className="label" x={pos[0]} y={pos[1] - 13} textAnchor="middle">{part.id}</text>
            )}
            {value && !(edit && edit.id === part.id) && (
              vertical
                ? <text className="value" x={pos[0] + 16} y={pos[1] + 10} onDoubleClick={() => startEdit(part)}>{value}</text>
                : <text className="value" x={pos[0]} y={pos[1] + 20} textAnchor="middle" onDoubleClick={() => startEdit(part)}>{value}</text>
            )}
            {pinPositions(part).map((pin) => {
              const q = shift([pin.x, pin.y], sel && drag?.kind === 'move');
              const open = unconnected.has(`${part.id}:${pin.name}`);
              return open
                ? <circle key={pin.name} cx={q[0]} cy={q[1]} r={3} className="pin open"><title>{part.id}: this pin isn't wired to anything</title></circle>
                : <circle key={pin.name} cx={q[0]} cy={q[1]} r={2} className="pin" />;
            })}
          </g>
        );
      })}
      {ghostPart && (
        <g className="part ghost" transform={`translate(${ghostPart.x} ${ghostPart.y}) rotate(${ghostPart.rot}) scale(${ghostPart.flip ? -1 : 1} 1)`}>
          <Symbol part={ghostPart} />
        </g>
      )}

      {/* junction dots */}
      {junctions.map((j, i) => <circle key={i} cx={j[0]} cy={j[1]} r={3} className="junction" />)}

      {/* probes */}
      {circuit.probes.map((pr) => {
        const color = probeColor(circuit, pr.id);
        const letter = probeLetter(circuit, pr.id);
        const sel = selection.probes.includes(pr.id);
        const readout = readouts[pr.id];
        const dragging = drag?.kind === 'probeHandle' && drag.id === pr.id ? drag : null;
        if (pr.kind === 'v' && pr.nodeAt) {
          const node = dragging?.handle === 'node' ? dragging.current : pr.nodeAt;
          const refPos = dragging?.handle === 'ref' ? dragging.current : refHandlePos(pr)!;
          const hasRef = !!pr.refAt || dragging?.handle === 'ref';
          return (
            <g key={pr.id} className={`probe${sel ? ' selected' : ''}`} style={{ color }}>
              {hasRef && <line x1={node[0]} y1={node[1]} x2={refPos[0]} y2={refPos[1]} className="probe-ref-line" />}
              <circle cx={refPos[0]} cy={refPos[1]} r={4} className={`probe-ref${hasRef ? ' active' : ''}`}>
                <title>{pr.refAt ? 'Reference point (−). Drag it away to measure against ground.' : 'Drag ○ to measure relative to another point'}</title>
              </circle>
              <circle cx={node[0]} cy={node[1]} r={5} className="probe-node" />
              <text x={node[0]} y={node[1] + 3} textAnchor="middle" className="probe-letter">{letter}</text>
              <Badge x={node[0] + 8} y={node[1] - 22} color={color} text={readout ? readout.text : (pr.label ?? `V${letter}`)} tooltip={readout?.tooltip ?? (pr.refAt ? 'Voltage from + to reference' : 'Voltage relative to ground')} />
            </g>
          );
        }
        if ((pr.kind === 'i' || pr.kind === 'p') && pr.element) {
          const part = circuit.parts.find((x) => x.id === pr.element);
          if (!part) return null;
          const pins = pinPositions(part);
          const a = pins[0], b = pins[1] ?? pins[0];
          const dir = (pr.dir ?? 1);
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          const ang = Math.atan2((b.y - a.y) * dir, (b.x - a.x) * dir) * 180 / Math.PI;
          const nx = -(b.y - a.y), ny = b.x - a.x;
          const nl = Math.hypot(nx, ny) || 1;
          const ox = mx + (nx / nl) * 14, oy = my + (ny / nl) * 14;
          return (
            <g key={pr.id} className={`probe${sel ? ' selected' : ''}`} style={{ color }}>
              <g transform={`translate(${ox} ${oy}) rotate(${ang})`}
                 onClick={(e) => { e.stopPropagation(); dispatch({ type: 'updateProbe', id: pr.id, patch: { dir: dir === 1 ? -1 : 1 } }); }}>
                <title>Reference direction — click the arrow to flip it</title>
                <path d="M-9 0 H9 M4 -4 L9 0 L4 4" className="probe-arrow" />
                <circle r={9} fill="transparent" />
              </g>
              <text x={ox} y={oy - 8} textAnchor="middle" className="probe-letter" fill={color}>{letter}</text>
              <Badge x={ox + 10} y={oy - 26} color={color} text={readout ? readout.text : (pr.label ?? (pr.kind === 'i' ? `I${letter}` : `P${letter}`))} tooltip={readout?.tooltip ?? (pr.kind === 'i' ? 'Current in the arrow direction' : 'Power absorbed by the part')} />
            </g>
          );
        }
        return null;
      })}

      {/* marquee */}
      {drag?.kind === 'marquee' && (
        <rect x={Math.min(drag.start[0], drag.current[0])} y={Math.min(drag.start[1], drag.current[1])}
              width={Math.abs(drag.current[0] - drag.start[0])} height={Math.abs(drag.current[1] - drag.start[1])} className="marquee" />
      )}

      {/* inline editor */}
      {edit && (() => {
        const part = circuit.parts.find((x) => x.id === edit.id);
        if (!part) return null;
        const vertical = part.rot === 90 || part.rot === 270;
        const x = vertical ? part.x + 14 : part.x - 36, y = vertical ? part.y + 2 : part.y + 10;
        return (
          <InlineEdit
            key={edit.id}
            x={x} y={y}
            initial={edit.value}
            onDone={(value, how) => {
              if (how === 'cancel') { setEdit((e) => (e && e.id === edit.id ? null : e)); return; }
              commitInline(edit.id, edit.param, value, how === 'next' ? 'next' : 'close');
            }}
          />
        );
      })()}
    </svg>
  );
}

function InlineEdit({ x, y, initial, onDone }: { x: number; y: number; initial: string; onDone: (value: string, how: 'enter' | 'next' | 'blur' | 'cancel') => void }) {
  const [value, setValue] = useState(initial);
  const finished = useRef(false);
  const done = (how: 'enter' | 'next' | 'blur' | 'cancel') => {
    if (finished.current) return;
    finished.current = true;
    onDone(value, how);
  };
  return (
    <foreignObject x={x} y={y} width={80} height={22}>
      <input
        autoFocus
        onFocus={(e) => e.target.select()}
        className="inline-edit"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') { e.preventDefault(); done('enter'); }
          else if (e.key === 'Tab') { e.preventDefault(); done('next'); }
          else if (e.key === 'Escape') { e.preventDefault(); done('cancel'); }
        }}
        onBlur={() => done('blur')}
      />
    </foreignObject>
  );
}

function Badge({ x, y, color, text, tooltip }: { x: number; y: number; color: string; text: string; tooltip: string }) {
  const w = Math.max(28, text.length * 6.2 + 10);
  return (
    <g className="badge">
      <title>{tooltip}</title>
      <rect x={x} y={y} width={w} height={16} rx={8} fill={color} />
      <text x={x + w / 2} y={y + 11.5} textAnchor="middle" fill="#fff">{text}</text>
    </g>
  );
}

export { distToSegment, partBox };
