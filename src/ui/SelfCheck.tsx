/**
 * Self-Check page (/#/selfcheck): runs every exercise file with the app's
 * default settings and shows expected vs. got, pass/fail, and run time.
 */
import { useMemo } from 'react';
import { EXERCISES, runExercise, type ExerciseReport } from '../exercises';
import { formatSI } from '../engine/units';

const TARGET_MS: Record<string, number> = { dc: 5, tran: 300, ac: 100 };

function fmt(x: number | null, unit: string): string {
  if (x === null) return '—';
  if (unit === '°' || unit === '') return x.toPrecision(4) + (unit === '°' ? '°' : '');
  return formatSI(x, unit, 4);
}

export function SelfCheck() {
  const reports = useMemo<ExerciseReport[]>(() => EXERCISES.flatMap((f) => runExercise(f)), []);
  const total = reports.reduce((n, r) => n + r.rows.length, 0);
  const passed = reports.reduce((n, r) => n + r.rows.filter((x) => x.pass).length, 0);
  return (
    <main>
      <h1>Self-Check</h1>
      <p>
        Each row is one reference value from <code>EXERCISES.md</code>. The solver runs the exercise circuit with
        its default settings and the result is compared with the book answer. Green = within tolerance.
      </p>
      <p><strong>{passed} of {total} checks pass.</strong> {passed === total ? '✅ All green.' : '❌ Something is off — see the red rows.'}</p>
      <p><a href="#/">Back</a></p>
      {reports.map((rep) => (
        <section key={rep.exercise + rep.variant}>
          <h2>
            {rep.exercise}{rep.variant ? ` (${rep.variant})` : ''} — {rep.title}
          </h2>
          <p className="muted">
            Analysis: {rep.analysis === 'dc' ? 'DC operating point' : rep.analysis === 'tran' ? 'Time (transient)' : 'Frequency (AC sweep)'} ·
            run time {rep.ms.toFixed(1)} ms (target &lt; {TARGET_MS[rep.analysis]} ms)
            {rep.ms > TARGET_MS[rep.analysis] ? ' ⚠ slower than target' : ''}
          </p>
          {rep.error && <p className="fail">Could not run: {rep.error}</p>}
          {rep.notes.length > 0 && <ul className="muted">{rep.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
          <table>
            <thead>
              <tr><th>Quantity</th><th>Expected</th><th>Got</th><th>Error</th><th>Tolerance</th><th>Result</th></tr>
            </thead>
            <tbody>
              {rep.rows.map((row, i) => (
                <tr key={i} className={row.pass ? 'pass' : 'fail'}>
                  <td>{row.label}</td>
                  <td>{fmt(row.expected, row.unit)}</td>
                  <td>{row.error ? row.error : fmt(row.got, row.unit)}</td>
                  <td>{row.errPct === null ? (row.got === null ? '—' : `abs ${row.got.toExponential(2)}`) : `${row.errPct.toFixed(3)} %`}</td>
                  <td>{row.tolerance}</td>
                  <td>{row.pass ? 'PASS' : 'FAIL'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </main>
  );
}
