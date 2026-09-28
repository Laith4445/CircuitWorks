/**
 * The editor screen: palette | canvas | inspector, run bar below. Owns the
 * editor state, keyboard shortcuts, running the solver, sharing and autosave.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { DiagnosticError, run, SolverError, formatSI, defaultStep, type TranResult } from '../engine';
import { extract, parseAnalysis, type Extraction } from '../schematic/extract';
import type { Circuit, Point } from '../schematic/model';
import { EXERCISES } from '../exercises';
import { circuitFromHash, decodeCircuit, encodeCircuit, migrate, toFileJson, URL_WARN_BYTES } from '../share/url';
import { clearAutosave, loadAutosave, saveAutosave } from '../share/storage';
import { Canvas, type ProbeReadout } from './Canvas';
import { Palette } from './Palette';
import { Inspector } from './Inspector';
import { RunBar } from './RunBar';
import { blankCircuit, initialState, reducer, type Tool } from './state';
import { lowestPoint } from './geometry';
import { HOTKEYS } from './symbols';
import { Plot } from './plot/Plot';
import { tracesFromTran, valueAt, type Trace } from './traces';
import { nextId } from './state';

type Status = { kind: 'ok' | 'error' | 'info'; text: string } | null;

function exerciseCircuit(id: string): Circuit | null {
  const ex = EXERCISES.find((e) => e.exercise.id === id);
  if (!ex) return null;
  const { exercise: _drop, ...rest } = ex;
  void _drop;
  return migrate(JSON.parse(JSON.stringify(rest)));
}

export function Editor() {
  const [state, dispatch] = useReducer(reducer, undefined, () => initialState());
  const [status, setStatus] = useState<Status>(null);
  const [readouts, setReadouts] = useState<Record<string, ProbeReadout>>({});
  const [partInfo, setPartInfo] = useState<Record<string, string>>({});
  const [highlight, setHighlight] = useState<Set<string>>(new Set());
  const [needsGround, setNeedsGround] = useState(false);
  const [fitRequest, setFitRequest] = useState(0);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const hasRun = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [traces, setTraces] = useState<Trace[]>([]);
  const [kept, setKept] = useState<Trace[]>([]);
  const [plotOpen, setPlotOpen] = useState(true);
  const [cursors, setCursors] = useState<{ a: number | null; b: number | null }>({ a: null, b: null });
  const [cursorX, setCursorX] = useState<number | null>(null);
  const [autoRerun, setAutoRerun] = useState(true);
  /** last Time/Frequency run, so adding a probe can reuse it without re-solving */
  const lastRun = useRef<{ sig: string; ex: Extraction; result: TranResult; ms: number } | null>(null);
  const tranSignature = (c: Circuit) => JSON.stringify({ p: c.parts, w: c.wires.map((w) => [w.from, w.to]), a: c.analysis });

  const loadCircuit = useCallback((c: Circuit, message?: string) => {
    dispatch({ type: 'load', circuit: c });
    setReadouts({}); setPartInfo({}); setHighlight(new Set()); setNeedsGround(false);
    setTraces([]); setKept([]); setCursors({ a: null, b: null }); lastRun.current = null;
    hasRun.current = false;
    setStatus(message ? { kind: 'info', text: message } : null);
    setTimeout(() => setFitRequest((n) => n + 1), 0);
  }, []);

  // ---- initial load: URL, exercise route, or autosave -------------------------
  useEffect(() => {
    const applyHash = async () => {
      const enc = circuitFromHash(location.hash);
      if (enc) {
        try { loadCircuit(await decodeCircuit(enc), 'Loaded the circuit from the link.'); }
        catch (e) { setStatus({ kind: 'error', text: `Couldn't read the circuit in this link: ${(e as Error).message}` }); }
        return true;
      }
      const m = /^#\/exercise\/(E\d)$/.exec(location.hash);
      if (m) {
        const c = exerciseCircuit(m[1]);
        if (c) { loadCircuit(c, `Loaded exercise ${m[1]}.`); return true; }
      }
      return false;
    };
    void applyHash().then((loaded) => {
      if (loaded) return;
      const saved = loadAutosave();
      if (saved && saved.parts.length && window.confirm('Restore your unsaved circuit from last time?')) loadCircuit(saved, 'Restored your unsaved circuit.');
      else if (saved && saved.parts.length) clearAutosave();
    });
    const onHash = () => { void applyHash(); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [loadCircuit]);

  // ---- autosave ------------------------------------------------------------------
  useEffect(() => {
    const t = setTimeout(() => saveAutosave(state.circuit), 300);
    return () => clearTimeout(t);
  }, [state.rev, state.circuit]);

  // ---- running --------------------------------------------------------------------
  const runNow = useCallback((live = false) => {
    const circuit = stateRef.current.circuit;
    const ex = extract(circuit);
    const errors = ex.diagnostics.filter((d) => d.severity === 'error');
    setNeedsGround(false);
    if (errors.length) {
      setHighlight(new Set(errors.flatMap((d) => d.ids)));
      setStatus({ kind: 'error', text: errors[0].message + (errors.length > 1 ? ` (+${errors.length - 1} more)` : '') });
      if (!live) { setReadouts({}); setPartInfo({}); }
      return;
    }
    let spec;
    try { spec = parseAnalysis(circuit.analysis); }
    catch (e) { setStatus({ kind: 'error', text: `Analysis settings: ${(e as Error).message}` }); return; }
    const t0 = performance.now();
    try {
      const out = run(ex.netlist, spec);
      const ms = performance.now() - t0;
      hasRun.current = true;
      setHighlight(new Set());
      const notes = out.diagnostics.map((d) => d.message).concat(out.result.notes);
      if (out.result.kind === 'dc') {
        const r = out.result;
        const ro: Record<string, ProbeReadout> = {};
        for (const pr of circuit.probes) {
          if (pr.kind === 'v' && pr.nodeAt) {
            const n = ex.nodeAtPoint(pr.nodeAt);
            const ref = pr.refAt ? ex.nodeAtPoint(pr.refAt) : '0';
            if (n === undefined || ref === undefined) { ro[pr.id] = { text: '?', tooltip: 'This probe is not on a wire or pin.' }; continue; }
            const v = r.v[n] - r.v[ref];
            ro[pr.id] = { text: formatSI(v, 'V'), tooltip: `V(${n}) − V(${ref}) = ${formatSI(v, 'V', 5)}` };
          } else if (pr.element && r.i[pr.element] !== undefined) {
            const el = ex.netlist.elements.find((e) => e.id === pr.element)!;
            const i = r.i[pr.element] * (pr.dir ?? 1);
            if (pr.kind === 'i') ro[pr.id] = { text: formatSI(i, 'A'), tooltip: `Current through ${pr.element} in the arrow direction: ${formatSI(i, 'A', 5)}. Negative = flows the other way.` };
            else {
              const p = (r.v[el.nodes[0]] - r.v[el.nodes[1]]) * r.i[pr.element];
              ro[pr.id] = { text: formatSI(p, 'W'), tooltip: `Power absorbed by ${pr.element}: ${formatSI(p, 'W', 5)}. Negative = delivering power.` };
            }
          }
        }
        setReadouts(ro);
        const info: Record<string, string> = {};
        for (const el of ex.netlist.elements) {
          if (el.type === 'OPAMP') { info[el.id] = `Output current ${formatSI(r.i[el.id], 'A')}`; continue; }
          const v = r.v[el.nodes[0]] - r.v[el.nodes[1]];
          info[el.id] = `${el.id}: V = ${formatSI(v, 'V')}, I = ${formatSI(r.i[el.id], 'A')}, P = ${formatSI(v * r.i[el.id], 'W')} (absorbed)`;
        }
        setPartInfo(info);
        setStatus({ kind: 'ok', text: `DC solved in ${ms.toFixed(1)} ms.${notes.length ? ' ' + notes.join(' ') : ''}` });
      } else if (out.result.kind === 'tran') {
        const r = out.result;
        lastRun.current = { sig: tranSignature(circuit), ex, result: r, ms };
        const tr = tracesFromTran(circuit, ex, r);
        setTraces(tr);
        setPlotOpen(true);
        setPartInfo({});
        setStatus({ kind: 'ok', text: `Time analysis solved: ${r.t.length.toLocaleString()} points, step ${formatSI(r.dt, 's')}, ${ms.toFixed(1)} ms.${notes.length ? ' ' + notes.join(' ') : ''}` });
      } else {
        const n = out.result.f.length;
        setStatus({ kind: 'info', text: `Frequency analysis solved (${n} points, ${ms.toFixed(1)} ms). The Bode plot arrives in the next milestone.${notes.length ? ' ' + notes.join(' ') : ''}` });
      }
    } catch (e) {
      if (e instanceof DiagnosticError) {
        const errs = e.diagnostics.filter((d) => d.severity === 'error');
        setHighlight(new Set(errs.flatMap((d) => d.ids)));
        setStatus({ kind: 'error', text: errs.map((d) => d.message).join(' ') });
        if (errs.some((d) => d.message.startsWith('Add a ground'))) setNeedsGround(true);
      } else if (e instanceof SolverError) {
        setHighlight(new Set(e.ids));
        setStatus({ kind: 'error', text: e.message });
      } else {
        setStatus({ kind: 'error', text: `Something went wrong: ${(e as Error).message}` });
      }
      if (!live) { setReadouts({}); setPartInfo({}); }
    }
  }, []);

  // live re-run after the first run (debounced). DC always; Time only when the
  // last run was quick (SPEC §6.1). Adding/moving a probe reuses the last Time result.
  useEffect(() => {
    if (!hasRun.current) return;
    const kind = state.circuit.analysis.kind;
    if (kind === 'dc') {
      const t = setTimeout(() => runNow(true), 150);
      return () => clearTimeout(t);
    }
    if (kind === 'tran' && lastRun.current) {
      const lr = lastRun.current;
      if (lr.sig === tranSignature(state.circuit)) {
        setTraces(tracesFromTran(state.circuit, lr.ex, lr.result));
        return;
      }
      if (autoRerun && lr.ms < 300) {
        const t = setTimeout(() => runNow(true), 200);
        return () => clearTimeout(t);
      }
    }
  }, [state.rev, state.circuit, runNow, autoRerun]);

  // probe badges for Time runs: value at the cursor, or the final value
  useEffect(() => {
    if (!traces.length) return;
    const ro: Record<string, ProbeReadout> = {};
    for (const t of traces) {
      const x = cursorX ?? t.x[t.x.length - 1];
      const v = valueAt(t, x);
      ro[t.id] = { text: formatSI(v, t.unit), tooltip: `${t.label} at t = ${formatSI(x, 's')}: ${formatSI(v, t.unit, 5)}${cursorX === null ? ' (end of run; hover the plot for other times)' : ''}` };
    }
    setReadouts(ro);
  }, [traces, cursorX]);

  // ---- keyboard -----------------------------------------------------------------
  useEffect(() => {
    const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const s = stateRef.current;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'Enter') { e.preventDefault(); runNow(); return; }
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); dispatch({ type: e.shiftKey ? 'redo' : 'undo' }); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); dispatch({ type: 'redo' }); return; }
      if (mod) return;
      switch (e.key) {
        case 'Escape':
          dispatch({ type: 'setTool', tool: { kind: 'select' } });
          dispatch({ type: 'select', selection: { parts: [], wires: [], probes: [] } });
          return;
        case 'Delete': case 'Backspace':
          e.preventDefault(); dispatch({ type: 'deleteSelection' }); return;
        case ' ':
          e.preventDefault();
          if (e.repeat) return;
          setSpaceHeld(true);
          if (s.tool.kind === 'place') dispatch({ type: 'setTool', tool: { ...s.tool, rot: ((s.tool.rot + 90) % 360) as Tool extends { rot: infer R } ? R : never } });
          else dispatch({ type: 'rotateSelection' });
          return;
        case '0': setFitRequest((n) => n + 1); return;
      }
      const k = e.key.toLowerCase();
      if (k === 'f') { if (s.tool.kind === 'place') dispatch({ type: 'setTool', tool: { ...s.tool, flip: !s.tool.flip } }); else dispatch({ type: 'flipSelection' }); return; }
      if (k === 'w') { dispatch({ type: 'setTool', tool: { kind: 'wire', points: [] } }); return; }
      if (k === 'p') { dispatch({ type: 'setTool', tool: { kind: 'probe', probeKind: 'v' } }); return; }
      const type = HOTKEYS[k];
      if (type) { dispatch({ type: 'setTool', tool: { kind: 'place', type, rot: 0, flip: false } }); }
    };
    const up = (e: KeyboardEvent) => { if (e.key === ' ') setSpaceHeld(false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [runNow]);

  // ---- sharing / files -------------------------------------------------------
  const share = async () => {
    const enc = await encodeCircuit(state.circuit);
    const url = `${location.origin}${location.pathname}#c=${enc}`;
    history.replaceState(null, '', `#c=${enc}`);
    let copied = false;
    try { await navigator.clipboard.writeText(url); copied = true; } catch { /* clipboard blocked */ }
    const warn = enc.length > URL_WARN_BYTES ? ' This link is long; some sites may cut it off.' : '';
    setStatus({ kind: 'info', text: `${copied ? 'Link copied to the clipboard' : 'Link is in the address bar'} (${enc.length} characters).${warn}` });
  };
  const exportFile = () => {
    const blob = new Blob([toFileJson(state.circuit)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'circuit.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importFile = async (f: File) => {
    try { loadCircuit(migrate(JSON.parse(await f.text())), `Opened ${f.name}.`); }
    catch (e) { setStatus({ kind: 'error', text: `Couldn't open ${f.name}: ${(e as Error).message}` }); }
  };
  const addGround = () => {
    const p: Point | null = lowestPoint(state.circuit);
    if (!p) return;
    dispatch({ type: 'addPart', part: { id: nextId(state.circuit, 'GND'), type: 'GND', x: p[0], y: p[1], rot: 0 } });
    setNeedsGround(false);
    setTimeout(() => runNow(), 0);
  };

  const ex = useMemo(() => extract(state.circuit), [state.circuit]);
  const derivedStep = useMemo(() => {
    const a = state.circuit.analysis;
    if (a.kind !== 'tran') return null;
    try { const spec = parseAnalysis(a); return spec.kind === 'tran' ? defaultStep(ex.netlist, spec.tEnd) : null; } catch { return null; }
  }, [state.circuit.analysis, ex]);

  return (
    <div className="editor">
      <Palette tool={state.tool} dispatch={dispatch} />
      <Canvas state={state} dispatch={dispatch} readouts={readouts} highlight={highlight} partInfo={partInfo} fitRequest={fitRequest} spaceHeld={spaceHeld} />
      <Inspector circuit={state.circuit} selection={state.selection} dispatch={dispatch} nodeAt={ex.nodeAtPoint} />
      <RunBar
        analysis={state.circuit.analysis}
        dispatch={dispatch}
        onRun={() => runNow()}
        onShare={() => void share()}
        onFit={() => setFitRequest((n) => n + 1)}
        onNew={() => { if (!state.circuit.parts.length || window.confirm('Start a new blank drawing? (Undo can bring the old one back.)')) { history.replaceState(null, '', '#/'); loadCircuit(blankCircuit()); } }}
        onExport={exportFile}
        onImport={(f) => void importFile(f)}
        onLoadExample={(id) => { const c = exerciseCircuit(id); if (c) { history.replaceState(null, '', `#/exercise/${id}`); loadCircuit(c, `Loaded exercise ${id}. Press Run.`); } }}
        canUndo={state.past.length > 0}
        canRedo={state.future.length > 0}
        status={status}
        fixGround={needsGround ? addGround : null}
        examples={EXERCISES.map((e) => ({ id: e.exercise.id, title: e.exercise.title }))}
        derivedStep={derivedStep}
        autoRerun={autoRerun}
        onAutoRerun={setAutoRerun}
      />
      {traces.length > 0 && (
        <section className={`plotpanel${plotOpen ? '' : ' collapsed'}`}>
          <div className="plotbar">
            <strong>Time plot</strong>
            <button onClick={() => setKept((k) => [...k, ...traces.map((t) => ({ ...t, kept: true, label: `${t.label} (kept)` }))])} title="Keep these traces as ghosts so the next run draws on top">Keep</button>
            <button onClick={() => setKept([])} disabled={!kept.length}>Clear kept{kept.length ? ` (${kept.length})` : ''}</button>
            <span className="muted small">Hover for values · click to pin cursor A, again for B · double-click clears</span>
            <span className="spacer" />
            <button onClick={() => setPlotOpen((o) => !o)}>{plotOpen ? 'Hide' : 'Show'}</button>
          </div>
          {plotOpen && (
            <Plot traces={[...kept, ...traces]} xLabel="t" xUnit="s" yLabel={[...new Set(traces.map((t) => t.unit))].join(' / ')} onCursor={setCursorX} cursors={cursors} onCursors={setCursors} />
          )}
        </section>
      )}
    </div>
  );
}
