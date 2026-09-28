/** "Try it yourself" mode: the problem text, what to measure, and a Check button (SPEC §3.4). */
import type { ExerciseFile } from '../exercises/check';
import { targetsFor, type GradeResult, fmt } from '../exercises/grade';

export function ExercisePanel({ file, result, onCheck, onSolution, onClose }: {
  file: ExerciseFile; result: GradeResult | null; onCheck: () => void; onSolution: () => void; onClose: () => void;
}) {
  const targets = targetsFor(file);
  const kind = file.analysis.kind === 'dc' ? 'DC' : file.analysis.kind === 'tran' ? `Time (end time ${file.analysis.tEnd})` : `Frequency (${file.analysis.fStart} – ${file.analysis.fStop})`;
  return (
    <section className="exercise">
      <h2>{file.exercise.id} · {file.exercise.title} <button className="link" onClick={onClose} title="Leave try-it mode">close</button></h2>
      <p>{file.exercise.problem}</p>
      <p className="muted small">Analysis: <b>{kind}</b>. Build the circuit, add probes for the quantities below, then press Check. Your part names and node names don't matter — only what the probes read.</p>
      <table className="grade">
        <thead><tr><th>Measure</th>{result && <><th>Yours</th><th></th></>}</tr></thead>
        <tbody>
          {targets.map((t, i) => {
            const row = result?.rows[i];
            return (
              <tr key={i} className={row ? (row.pass ? 'pass' : 'fail') : ''}>
                <td>{t.label}</td>
                {row && <td>{row.got === null ? '—' : fmt(row.got, t.unit)}{row.probe ? <span className="muted"> ({row.probe})</span> : ''}</td>}
                {row && <td>{row.pass ? '✓' : '✗'}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
      {result?.error && <p className="fail-text">{result.error}</p>}
      {result && !result.error && (
        <p className={result.passed === result.total ? 'pass-text' : ''}>
          <b>{result.passed} of {result.total}</b> correct.{result.passed === result.total ? ' Well done!' : ''}
        </p>
      )}
      {result && !result.error && result.rows.filter((r) => !r.pass && r.hint).slice(0, 3).map((r, i) => <p key={i} className="muted small">• {r.label}: {r.hint}</p>)}
      <div className="exercise-buttons">
        <button className="primary" onClick={onCheck}>Check</button>
        <button onClick={onSolution} title="Replace your drawing with the worked example (undo brings yours back)">Show the worked example</button>
      </div>
    </section>
  );
}
