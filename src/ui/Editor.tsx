/**
 * The editor screen: palette | canvas | inspector, run bar below. Owns the
 * editor state, keyboard shortcuts, running the solver, sharing and autosave.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { DiagnosticError, run, SolverError, formatSI, defaultStep, type TranResult, type AcResult } from '../engine';
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
import { Bode } from './plot/Bode';
import { tracesFromTran, tracesFromAc, initialReadouts, valueAt, cleanTiny, type Trace, type InitialReadout } from './traces';
import { nextProbeId } from './state';
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
  /** frequency-sweep traces (magnitude + phase); empty when the last run was a Time run */
  const [ac, setAc] = useState<{ mag: Trace[]; phase: Trace[] }>({ mag: [], phase: [] });
  const [kept, setKept] = useState<Trace[]>([]);
  const [db, setDb] = useState(true);
  const [initial, setInitial] = useState<InitialReadout[]>([]);
  const [tEndLabel, setTEndLabel] = useState('');
  const [plotOpen, setPlotOpen] = useState(true);
  const [cursors, setCursors] = useState<{ a: number | null; b: number | null }>({ a: null, b: null });
  const [cursorX, setCursorX] = useState<number | null>(null);
  const [autoRerun, setAutoRerun] = useState(true);
  /** re-fit the drawing once the plot panel first takes space away from it */
  const firstPlot = useRef(true);
  /** last Time/Frequency run, so adding a probe can reuse it without re-solving */
  const lastRun = useRef<{ sig: string; ex: Extraction; result: TranResult | AcResult; ms: number } | null>(null);
  const tranSignature = (c: Circuit) => JSON.stringify({ p: c.parts, w: c.wires.map((w) => [w.from, w.to]), a: c.analysis });

  const loadCircuit = useCallback((c: Circuit, message?: string) => {
    dispatch({ type: 'load', circuit: c });
    setReadouts({}); setPartInfo({}); setHighlight(new Set()); setNeedsGround(false);
    setTraces([]); setInitial([]); setAc({ mag: [], phase: [] }); setKept([]); setCursors({ a: null, b: null }); lastRun.current = null; firstPlot.current = true;
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
        setInitial(initialReadouts(circuit, ex, r));
        setTEndLabel(formatSI(r.t[r.t.length - 1], 's'));
        setAc({ mag: [], phase: [] });
        setPlotOpen(true);
        setPartInfo({});
        if (firstPlot.current) { firstPlot.current = false; setTimeout(() => setFitRequest((n) => n + 1), 50); }
        setStatus({ kind: 'ok', text: `Time analysis solved: ${r.t.length.toLocaleString()} points, step ${formatSI(r.dt, 's')}, ${ms.toFixed(1)} ms.${notes.length ? ' ' + notes.join(' ') : ''}` });
      } else {
        const r = out.result;
        lastRun.current = { sig: tranSignature(circuit), ex, result: r, ms };
        setAc(tracesFromAc(circuit, ex, r));
        setTraces([]);
        setPlotOpen(true);
        setPartInfo({});
        if (firstPlot.current) { firstPlot.current = false; setTimeout(() => setFitRequest((n) => n + 1), 50); }
        setStatus({ kind: 'ok', text: `Frequency sweep solved: ${r.f.length} points, ${ms.toFixed(1)} ms.${notes.length ? ' ' + notes.join(' ') : ''}` });
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
    if ((kind === 'tran' || kind === 'ac') && lastRun.current && lastRun.current.result.kind === kind) {
      const lr = lastRun.current;
      if (lr.sig === tranSignature(state.circuit)) {
        if (lr.result.kind === 'tran') { setTraces(tracesFromTran(state.circuit, lr.ex, lr.result)); setInitial(initialReadouts(state.circuit, lr.ex, lr.result)); }
        else setAc(tracesFromAc(state.circuit, lr.ex, lr.result));
        return;
      }
      if (autoRerun && lr.ms < 300) {
        const t = setTimeout(() => runNow(true), 200);
        return () => clearTimeout(t);
      }
    }
  }, [state.rev, state.circuit, runNow, autoRerun]);

  // probe badges for Frequency runs: magnitude at the cursor (or at the highest frequency)
  useEffect(() => {
    if (!ac.mag.length) return;
    const ro: Record<string, ProbeReadout> = {};
    for (const t of ac.mag) {
      const x = cursorX ?? t.x[t.x.length - 1];
      const m = valueAt(t, x);
      const ph = valueAt(ac.phase.find((q) => q.id === t.id)!, x);
      const text = t.unit === '' ? (db ? `${(20 * Math.log10(Math.max(m, 1e-300))).toFixed(1)} dB` : m.toPrecision(3)) : formatSI(m, t.unit);
      ro[t.id] = { text, tooltip: `${t.label} at ${formatSI(x, 'Hz', 4)}: |${t.label}| = ${t.unit === '' ? m.toPrecision(5) : formatSI(m, t.unit, 5)} (${(20 * Math.log10(Math.max(m, 1e-300))).toFixed(2)} dB), phase ${ph.toFixed(2)}°${cursorX === null ? ' (top of sweep; hover the plot for other frequencies)' : ''}` };
    }
    setReadouts(ro);
  }, [ac, cursorX, db]);

  // probe badges for Time runs: value at the cursor, or the final value
  useEffect(() => {
    if (!traces.length) return;
    const ro: Record<string, ProbeReadout> = {};
    for (const t of traces) {
      const x = cursorX ?? t.x[t.x.length - 1];
      let scale = 0;
      for (let k = 0; k < t.y.length; k++) scale = Math.max(scale, Math.abs(t.y[k]));
      const v = cleanTiny(valueAt(t, x), scale);
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
  const selectedVoltageProbes = state.selection.probes.filter((id) => state.circuit.probes.find((p) => p.id === id)?.kind === 'v');
  const makeRatio = () => {
    if (selectedVoltageProbes.length !== 2) return;
    const [num, den] = selectedVoltageProbes;
    dispatch({ type: 'addProbe', probe: { id: nextProbeId(state.circuit), kind: 'ratio', num, den } });
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
      {(traces.length > 0 || ac.mag.length > 0) && (
        <section className={`plotpanel${plotOpen ? '' : ' collapsed'}`}>
          <div className="plotbar">
            <strong>{ac.mag.length ? 'Frequency plot' : 'Time plot'}</strong>
            <button onClick={() => setKept((k) => [...k, ...[...traces, ...ac.mag, ...ac.phase].map((t) => ({ ...t, kept: true, label: `${t.label} (kept)` }))])} title="Keep these traces as ghosts so the next run draws on top">Keep</button>
            <button onClick={() => setKept([])} disabled={!kept.length}>Clear kept{kept.length ? ` (${kept.length})` : ''}</button>
            {ac.mag.length > 0 && <button onClick={() => setDb((d) => !d)} title="Show magnitude in decibels or as a plain ratio">{db ? 'dB' : 'linear'}</button>}
            <button onClick={makeRatio} disabled={selectedVoltageProbes.length !== 2} title="Select two voltage probes (shift-click) and press Ratio to plot the first divided by the second (a transfer function)">Ratio</button>
            <span className="muted small">Hover for values · click pins cursor A, again B · wheel zooms · double-click resets</span>
            <span className="spacer" />
            <button onClick={() => setPlotOpen((o) => !o)}>{plotOpen ? 'Hide' : 'Show'}</button>
          </div>
          {plotOpen && ac.mag.length > 0 && (
            <Bode mag={[...kept.filter((t) => t.panel === 'mag'), ...ac.mag]} phase={[...kept.filter((t) => t.panel === 'phase'), ...ac.phase]} db={db} onCursor={setCursorX} cursors={cursors} onCursors={setCursors} />
          )}
          {plotOpen && ac.mag.length === 0 && initial.length > 0 && (
            <table className="initial-table" title="Just before t = 0: switches in their starting state, steady state. Just after: switches flipped; capacitor voltages and inductor currents can't jump, everything else can.">
              <thead><tr><th>Probe</th><th>just before t = 0 (0⁻)</th><th>just after (0⁺)</th><th>end of run (t = {tEndLabel})</th></tr></thead>
              <tbody>
                {initial.map((row) => (
                  <tr key={row.id}>
                    <td style={{ color: row.color }}>{row.label}</td>
                    <td>{formatSI(row.before, row.unit, 4)}</td>
                    <td>{formatSI(row.after, row.unit, 4)}</td>
                    <td>{formatSI(row.end, row.unit, 4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {plotOpen && ac.mag.length === 0 && (
            <Plot traces={[...kept.filter((t) => !t.panel), ...traces]} xLabel="t" xUnit="s" yLabel={[...new Set(traces.map((t) => t.unit))].join(' / ')} onCursor={setCursorX} cursors={cursors} onCursors={setCursors} />
          )}
        </section>
      )}
    </div>
  );
}
