/**
 * Frequency-sweep view: two stacked panels (magnitude, phase) on a log
 * frequency axis, one shared cursor, and a table with |H| and phase at A, B, Δ.
 */
import { useState } from 'react';
import { Plot } from './Plot';
import { formatSI } from '../../engine/units';
import { toDb, valueAt, type Trace } from '../traces';

export interface BodeProps {
  mag: Trace[];
  phase: Trace[];
  onCursor?: (x: number | null) => void;
  cursors: { a: number | null; b: number | null };
  onCursors: (c: { a: number | null; b: number | null }) => void;
  db: boolean;
}

function fmtMag(v: number, unit: string, db: boolean): string {
  if (db) return `${v.toFixed(2)} dB`;
  return unit === '' ? v.toPrecision(4) : formatSI(v, unit, 4);
}

export function Bode({ mag, phase, onCursor, cursors, onCursors, db }: BodeProps) {
  const [hover, setHover] = useState<number | null>(null);
  const [xRange, setXRange] = useState<[number, number] | null>(null);
  const magShown = db ? mag.map(toDb) : mag;
  const live = mag.filter((t) => !t.kept);
  const row = (t: Trace, x: number | null) => {
    if (x === null) return { m: '', p: '' };
    const p = phase.find((q) => q.id === t.id && !q.kept)!;
    const m = valueAt(t, x);
    return { m: db ? fmtMag(20 * Math.log10(Math.max(m, 1e-300)), '', true) : fmtMag(m, t.unit, false), p: `${valueAt(p, x).toFixed(1)}°` };
  };
  return (
    <div className="bode">
      <Plot traces={magShown} xLabel="f" xUnit="Hz" yLabel={db ? 'magnitude (dB)' : 'magnitude'} xLog height={200}
        cursors={cursors} onCursors={onCursors} hover={hover} onHover={setHover} onCursor={onCursor} showTable={false} yUnit={db ? 'dB' : undefined} xRange={xRange} onXRange={setXRange} />
      <Plot traces={phase} xLabel="f" xUnit="Hz" yLabel="phase (°)" xLog height={160}
        cursors={cursors} onCursors={onCursors} hover={hover} onHover={setHover} showTable={false} yUnit="°" xRange={xRange} onXRange={setXRange} />
      {(cursors.a !== null || cursors.b !== null) && (
        <table className="cursor-table">
          <thead><tr><th></th>
            <th>A {cursors.a !== null ? `(${formatSI(cursors.a, 'Hz', 4)})` : ''}</th>
            <th>B {cursors.b !== null ? `(${formatSI(cursors.b, 'Hz', 4)})` : ''}</th>
            <th>Δ {cursors.a !== null && cursors.b !== null ? `(${formatSI(cursors.b - cursors.a, 'Hz', 4)})` : ''}</th></tr></thead>
          <tbody>
            {live.map((t) => {
              const a = row(t, cursors.a), b = row(t, cursors.b);
              return (
                <tr key={t.id}><td style={{ color: t.color }}>{t.label}</td>
                  <td>{a.m}{a.p && <span className="muted"> ∠ {a.p}</span>}</td>
                  <td>{b.m}{b.p && <span className="muted"> ∠ {b.p}</span>}</td>
                  <td></td></tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
