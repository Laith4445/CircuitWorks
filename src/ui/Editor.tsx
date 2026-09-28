/**
 * The editor screen: palette | canvas | inspector, run bar below. Owns the
 * editor state, keyboard shortcuts, running the solver, sharing and autosave.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { DiagnosticError, run, SolverError, formatSI } from '../engine';
import { extract, parseAnalysis } from '../schematic/extract';
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

  const loadCircuit = useCallback((c: Circuit, message?: string) => {
    dispatch({ type: 'load', circuit: c });
    setReadouts({}); setPartInfo({}); setHighlight(new Set()); setNeedsGround(false);
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
      } else {
        const n = out.result.kind === 'tran' ? out.result.t.length : out.result.f.length;
        setStatus({ kind: 'info', text: `${out.result.kind === 'tran' ? 'Time' : 'Frequency'} analysis solved (${n} points, ${ms.toFixed(1)} ms). The plot panel arrives in the next milestone.${notes.length ? ' ' + notes.join(' ') : ''}` });
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

  // live re-run of DC after the first run (debounced)
  useEffect(() => {
    if (!hasRun.current || state.circuit.analysis.kind !== 'dc') return;
    const t = setTimeout(() => runNow(true), 150);
    return () => clearTimeout(t);
  }, [state.rev, state.circuit.analysis.kind, runNow]);

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
  const nodeNames = useMemo(() => Object.fromEntries(ex.nodeOfPoint), [ex]);

  return (
    <div className="editor">
      <Palette tool={state.tool} dispatch={dispatch} />
      <Canvas state={state} dispatch={dispatch} readouts={readouts} highlight={highlight} partInfo={partInfo} fitRequest={fitRequest} spaceHeld={spaceHeld} />
      <Inspector circuit={state.circuit} selection={state.selection} dispatch={dispatch} nodeNames={nodeNames} />
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
      />
    </div>
  );
}
