/** Right panel: parameters of the selected part / probe, with the parsed value shown beside each field. */
import { pinPositions, type Circuit, type Part, type Probe } from '../schematic/model';
import { describeValue, formatSI, parseValue } from '../engine/units';
import type { Action, Selection } from './state';
import { PART_NAMES } from './symbols';

interface Field { name: string; label: string; unit: string; optional?: boolean }

const FIELDS: Partial<Record<Part['type'], Field[]>> = {
  R: [{ name: 'R', label: 'Resistance', unit: 'Ω' }],
  C: [{ name: 'C', label: 'Capacitance', unit: 'F' }, { name: 'ic', label: 'Initial voltage (optional)', unit: 'V', optional: true }],
  L: [{ name: 'L', label: 'Inductance', unit: 'H' }, { name: 'ic', label: 'Initial current (optional)', unit: 'A', optional: true }],
  Vdc: [{ name: 'V', label: 'Voltage', unit: 'V' }],
  Idc: [{ name: 'I', label: 'Current', unit: 'A' }],
  VCVS: [{ name: 'gain', label: 'Gain (V/V)', unit: '' }],
  VCCS: [{ name: 'gain', label: 'Gain (A/V)', unit: 'S' }],
  CCVS: [{ name: 'gain', label: 'Gain (V/A)', unit: 'Ω' }],
  CCCS: [{ name: 'gain', label: 'Gain (A/A)', unit: '' }],
};

const WAVE_FIELDS: Record<string, Field[]> = {
  sine: [{ name: 'vo', label: 'Offset', unit: 'V' }, { name: 'va', label: 'Amplitude (peak)', unit: 'V' }, { name: 'f', label: 'Frequency', unit: 'Hz' }, { name: 'phase', label: 'Phase', unit: '°' }, { name: 'td', label: 'Delay', unit: 's' }],
  pulse: [{ name: 'v1', label: 'Low level', unit: 'V' }, { name: 'v2', label: 'High level', unit: 'V' }, { name: 'td', label: 'Delay', unit: 's' }, { name: 'tr', label: 'Rise time', unit: 's' }, { name: 'tf', label: 'Fall time', unit: 's' }, { name: 'pw', label: 'Pulse width', unit: 's' }, { name: 'per', label: 'Period', unit: 's' }],
  step: [{ name: 'v1', label: 'Before', unit: 'V' }, { name: 'v2', label: 'After', unit: 'V' }, { name: 'td', label: 'Step time', unit: 's' }, { name: 'tr', label: 'Rise time', unit: 's' }],
};
const AC_FIELDS: Field[] = [{ name: 'acMag', label: 'AC sweep amplitude (peak)', unit: 'V' }, { name: 'acPhase', label: 'AC sweep phase', unit: '°' }];

function ValueField({ field, value, onChange }: { field: Field; value: string; onChange: (v: string) => void }) {
  let hint = '';
  let bad = false;
  if (value.trim() === '') { hint = field.optional ? 'not set' : 'required'; bad = !field.optional; }
  else {
    try { parseValue(value); hint = describeValue(value, field.unit); } catch (e) { hint = (e as Error).message; bad = true; }
  }
  return (
    <label className="field">
      <span>{field.label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} className={bad ? 'bad' : ''} />
      <small className={bad ? 'bad' : ''}>{hint}</small>
    </label>
  );
}

export function Inspector({ circuit, selection, dispatch, nodeAt }: { circuit: Circuit; selection: Selection; dispatch: (a: Action) => void; nodeAt: (p: [number, number]) => string | undefined }) {
  const part = selection.parts.length === 1 ? circuit.parts.find((p) => p.id === selection.parts[0]) : undefined;
  const probe = selection.probes.length === 1 ? circuit.probes.find((p) => p.id === selection.probes[0]) : undefined;

  if (part) return <PartInspector part={part} circuit={circuit} dispatch={dispatch} />;
  if (probe) return <ProbeInspector probe={probe} circuit={circuit} dispatch={dispatch} nodeAt={nodeAt} />;
  const n = selection.parts.length + selection.wires.length + selection.probes.length;
  return (
    <aside className="inspector">
      <h2>Inspector</h2>
      {n > 1 ? <p>{n} things selected. Drag to move, Delete to remove, Space to rotate.</p> : (
        <div className="muted tips">
          <p>Select a part to edit its value here, or double-click it on the drawing.</p>
          <p><b>Place:</b> click a part in the palette (or press its key), then click on the drawing. <b>Space</b> rotates, <b>F</b> mirrors, <b>Esc</b> cancels.</p>
          <p><b>Wire:</b> click a pin and drag, or press <b>W</b> and click from point to point. A dot marks a junction.</p>
          <p><b>Red pins</b> aren't connected yet. The circuit can't run until they are.</p>
          <p><b>Probe:</b> press <b>P</b> and drop it on a wire. Drag its ○ to another point to measure between two points.</p>
          <p><b>Run:</b> the Run button or <b>Ctrl/⌘+Enter</b>. Values appear on the drawing. <b>0</b> fits the drawing to the window.</p>
          <p><b>Transfer function:</b> shift-click two voltage probes, then press <b>Ratio</b> in the plot bar.</p>
        </div>
      )}
    </aside>
  );
}

function PartInspector({ part, circuit, dispatch }: { part: Part; circuit: Circuit; dispatch: (a: Action) => void }) {
  const p = part.params ?? {};
  const set = (name: string, value: string) => dispatch({ type: 'setParam', id: part.id, name, value });
  const fields = FIELDS[part.type] ?? [];
  const isDep = part.type === 'VCVS' || part.type === 'VCCS' || part.type === 'CCVS' || part.type === 'CCCS';
  const currentCtrl = part.type === 'CCVS' || part.type === 'CCCS';
  const candidates = circuit.parts.filter((x) => x.id !== part.id && x.type !== 'GND' && x.type !== 'OPAMP' &&
    (!currentCtrl || ['R', 'Vdc', 'Vwave', 'L', 'SW', 'VCVS', 'CCVS'].includes(x.type)));
  return (
    <aside className="inspector">
      <h2>{part.id} <span className="muted">— {PART_NAMES[part.type]}</span></h2>
      {fields.map((f) => <ValueField key={f.name} field={f} value={p[f.name] ?? ''} onChange={(v) => set(f.name, v)} />)}
      {part.type === 'Vwave' && (
        <>
          <label className="field"><span>Waveform</span>
            <select value={p.type ?? 'pulse'} onChange={(e) => set('type', e.target.value)}>
              <option value="sine">Sine</option><option value="pulse">Pulse</option><option value="step">Step</option>
            </select>
          </label>
          {(WAVE_FIELDS[p.type ?? 'pulse'] ?? []).map((f) => <ValueField key={f.name} field={f} value={p[f.name] ?? ''} onChange={(v) => set(f.name, v)} />)}
          {p.type === 'sine' && p.va && (() => { try { return <p className="muted">RMS: {formatSI(parseValue(p.va) / Math.SQRT2, 'V')} (amplitudes are peak values, as in the book)</p>; } catch { return null; } })()}
          <h3>For Frequency sweeps</h3>
          {AC_FIELDS.map((f) => <ValueField key={f.name} field={f} value={p[f.name] ?? ''} onChange={(v) => set(f.name, v)} />)}
        </>
      )}
      {isDep && (
        <label className="field">
          <span>Controlled by the {currentCtrl ? 'current through' : 'voltage across'}</span>
          <select value={p.ctrl ?? ''} onChange={(e) => set('ctrl', e.target.value)}>
            <option value="">— choose a part —</option>
            {candidates.map((x) => <option key={x.id} value={x.id}>{x.id} ({PART_NAMES[x.type]})</option>)}
          </select>
          <small>{currentCtrl ? 'Positive current flows from the part’s pin a to pin b (left→right when unrotated, top→bottom when rotated 90°).' : 'Voltage = V(pin a) − V(pin b).'}</small>
        </label>
      )}
      {part.type === 'SW' && (
        <>
          <label className="field"><span>State before t = 0</span>
            <select value={p.init ?? 'open'} onChange={(e) => set('init', e.target.value)}>
              <option value="closed">Closed</option><option value="open">Open</option>
            </select>
          </label>
          <label className="field check"><input type="checkbox" checked={(p.toggle ?? 'true') !== 'false'} onChange={(e) => set('toggle', e.target.checked ? 'true' : 'false')} /> <span>Flips at t = 0 in a Time run</span></label>
        </>
      )}
      {part.type === 'OPAMP' && <p className="muted">Ideal op amp: V+ = V−, no input current, no supply limits (saturation isn't modelled yet).</p>}
      {part.type === 'GND' && <p className="muted">All ground symbols are the same node (0 V).</p>}
      <p className="muted small">Rotation {part.rot}° {part.flip ? '(mirrored)' : ''} · Space rotates · F mirrors · Delete removes</p>
    </aside>
  );
}

function ProbeInspector({ probe, circuit, dispatch, nodeAt }: { probe: Probe; circuit: Circuit; dispatch: (a: Action) => void; nodeAt: (p: [number, number]) => string | undefined }) {
  const set = (patch: Partial<Probe>) => dispatch({ type: 'updateProbe', id: probe.id, patch });
  const nodeOf = (pt?: [number, number]) => (pt ? nodeAt(pt) ?? '(not on a wire)' : '—');
  return (
    <aside className="inspector">
      <h2>{probe.id} <span className="muted">— {probe.kind === 'v' ? 'Voltage probe' : probe.kind === 'i' ? 'Current probe' : probe.kind === 'p' ? 'Power probe' : 'Ratio (transfer function)'}</span></h2>
      <label className="field"><span>Label (optional)</span><input value={probe.label ?? ''} onChange={(e) => set({ label: e.target.value || undefined })} /></label>
      {probe.kind === 'v' && (
        <>
          <p>Measures node <b>{nodeOf(probe.nodeAt)}</b> relative to <b>{probe.refAt ? nodeOf(probe.refAt) : 'ground'}</b>.</p>
          {probe.refAt ? <button onClick={() => set({ refAt: undefined })}>Measure relative to ground instead</button>
            : <p className="muted">Drag the small ○ next to the probe onto another wire to measure between two points.</p>}
        </>
      )}
      {probe.kind === 'ratio' && <p>Plots <b>{probe.num}</b> divided by <b>{probe.den}</b> in a Frequency run: magnitude and phase of the transfer function.</p>}
      {(probe.kind === 'i' || probe.kind === 'p') && (
        <>
          <p>On part <b>{probe.element}</b>.</p>
          <button onClick={() => set({ dir: (probe.dir ?? 1) === 1 ? -1 : 1 })}>Flip reference direction</button>
          {probe.kind === 'p' && (probe.nodeAt
            ? <>
                <p>Wattmeter: voltage from <b>{nodeOf(probe.nodeAt)}</b> to <b>{probe.refAt ? nodeOf(probe.refAt) : 'ground'}</b>, current through <b>{probe.element}</b>. Drag the two voltage handles on the drawing.</p>
                <button onClick={() => set({ nodeAt: undefined, refAt: undefined })}>Use the part's own voltage instead</button>
              </>
            : <button onClick={() => {
                const part = circuit.parts.find((x) => x.id === probe.element);
                if (!part) return;
                const pins = pinPositions(part);
                set({ nodeAt: [pins[0].x, pins[0].y], refAt: [pins[1].x, pins[1].y] });
              }} title="A wattmeter senses current through this part but can measure voltage across a bigger piece of the circuit">Make it a wattmeter (separate voltage points)</button>)}
          <p className="muted">{probe.kind === 'i' ? 'A negative reading means the current actually flows against the arrow.' : 'Power absorbed (passive sign convention); negative means it is delivering power. In a Time run the table under the plot gives the average over whole cycles; in a Frequency sweep the power panel shows the average power at each frequency.'}</p>
        </>
      )}
    </aside>
  );
}
