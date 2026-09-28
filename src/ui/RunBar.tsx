/** Run bar: the three analyses as tabs with their parameters inline, Run, Share, undo/redo, examples. */
import type { AnalysisJson } from '../schematic/model';
import { describeValue, formatSI } from '../engine/units';
import type { Action } from './state';

export interface RunBarProps {
  analysis: AnalysisJson;
  dispatch: (a: Action) => void;
  onRun: () => void;
  onShare: () => void;
  onFit: () => void;
  onNew: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onLoadExample: (id: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  status: { kind: 'ok' | 'error' | 'info'; text: string } | null;
  fixGround: (() => void) | null;
  examples: { id: string; title: string }[];
  derivedStep: number | null;
  autoRerun: boolean;
  onAutoRerun: (v: boolean) => void;
  onExportDrawing: (kind: 'svg' | 'png') => void;
  onExportPlot: () => void;
  onHelp: () => void;
}

function Field({ label, value, unit, onChange }: { label: string; value: string; unit: string; onChange: (v: string) => void }) {
  let hint = '';
  try { hint = describeValue(value, unit); } catch { hint = '?'; }
  return (
    <label className="runfield" title={hint}>
      <span>{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} size={7} />
    </label>
  );
}

export function RunBar(p: RunBarProps) {
  const a = p.analysis;
  const setA = (analysis: AnalysisJson) => p.dispatch({ type: 'setAnalysis', analysis });
  const tab = (kind: AnalysisJson['kind']) => {
    if (kind === a.kind) return;
    if (kind === 'dc') setA({ kind: 'dc' });
    if (kind === 'tran') setA({ kind: 'tran', tEnd: '10ms' });
    if (kind === 'ac') setA({ kind: 'ac', fStart: '10', fStop: '1MEG', pointsPerDecade: 100, log: true });
  };
  return (
    <div className="runbar">
      <div className="tabs">
        <button className={a.kind === 'dc' ? 'active' : ''} onClick={() => tab('dc')}>DC</button>
        <button className={a.kind === 'tran' ? 'active' : ''} onClick={() => tab('tran')}>Time</button>
        <button className={a.kind === 'ac' ? 'active' : ''} onClick={() => tab('ac')}>Frequency</button>
      </div>
      {a.kind === 'dc' && <span className="muted">DC operating point</span>}
      {a.kind === 'tran' && (
        <>
          <Field label="End time" value={a.tEnd} unit="s" onChange={(v) => setA({ ...a, tEnd: v })} />
          <label className="runfield" title="Advanced: the time step. Leave blank to let the app choose (shown as the placeholder).">
            <span>Step</span>
            <input value={a.dt ?? ''} placeholder={p.derivedStep ? `auto ${formatSI(p.derivedStep, 's')}` : 'auto'} size={9} onChange={(e) => setA({ ...a, dt: e.target.value || undefined })} />
          </label>
          <label className="runfield" title="Re-run automatically after each edit (only when the last run took under 300 ms)">
            <input type="checkbox" checked={p.autoRerun} onChange={(e) => p.onAutoRerun(e.target.checked)} /> <span>auto</span>
          </label>
        </>
      )}
      {a.kind === 'ac' && (
        <>
          <Field label="From" value={a.fStart} unit="Hz" onChange={(v) => setA({ ...a, fStart: v })} />
          <Field label="To" value={a.fStop} unit="Hz" onChange={(v) => setA({ ...a, fStop: v })} />
        </>
      )}
      <button className="run" onClick={p.onRun} title="Solve the circuit with the selected analysis (Ctrl/⌘+Enter)">▶ Run analysis</button>
      <span className={`status ${p.status?.kind ?? ''}`}>
        {p.status?.text}
        {p.fixGround && <button className="link" onClick={p.fixGround}>Add ground at the lowest point?</button>}
      </span>
      <span className="spacer" />
      <button onClick={() => p.dispatch({ type: 'undo' })} disabled={!p.canUndo} title="Undo (Ctrl/⌘+Z)">↶</button>
      <button onClick={() => p.dispatch({ type: 'redo' })} disabled={!p.canRedo} title="Redo (Ctrl/⌘+Shift+Z)">↷</button>
      <button onClick={p.onFit} title="Fit drawing to window (0)">Fit</button>
      <select value="" onChange={(e) => { if (e.target.value) p.onLoadExample(e.target.value); }} title="Load a book exercise">
        <option value="">Exercises…</option>
        <optgroup label="Try it yourself (blank canvas + Check)">
          {p.examples.map((ex) => <option key={`try:${ex.id}`} value={`try:${ex.id}`}>{ex.id} — {ex.title}</option>)}
        </optgroup>
        <optgroup label="Worked examples (already built)">
          {p.examples.map((ex) => <option key={ex.id} value={ex.id}>{ex.id} — {ex.title}</option>)}
        </optgroup>
      </select>
      <button onClick={p.onNew} title="Start a blank drawing">New</button>
      <button onClick={p.onExport} title="Save the circuit as a .json file">Save file</button>
      <label className="filebtn" title="Open a saved .json circuit">Open file<input type="file" accept=".json,application/json" onChange={(e) => { const f = e.target.files?.[0]; if (f) p.onImport(f); e.target.value = ''; }} /></label>
      <select value="" onChange={(e) => { const v = e.target.value; e.target.value = ''; if (v === 'svg' || v === 'png') p.onExportDrawing(v); else if (v === 'plot') p.onExportPlot(); }} title="Export pictures for homework">
        <option value="">Export…</option>
        <option value="png">Drawing as PNG</option>
        <option value="svg">Drawing as SVG</option>
        <option value="plot">Plot as PNG</option>
      </select>
      <button className="help-btn" onClick={p.onHelp} title="Keyboard reference and quick tour (press ?)"><span className="help-icon">?</span> Help</button>
      <button className="share" onClick={p.onShare} title="Copy a link to this circuit">Share ↗</button>
    </div>
  );
}
