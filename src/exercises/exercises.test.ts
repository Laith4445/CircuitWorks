/**
 * Every reference value in EXERCISES.md is a test here. The same JSON files
 * and the same checker feed the Self-Check page, so there is one source of truth.
 */
import { describe, it, expect } from 'vitest';
import { EXERCISES, runExercise } from './index';

for (const file of EXERCISES) {
  const reports = runExercise(file);
  for (const rep of reports) {
    describe(`${rep.exercise}${rep.variant ? ' / ' + rep.variant : ''} — ${rep.title}`, () => {
      it('runs without error', () => {
        expect(rep.error, rep.error).toBeUndefined();
      });
      for (const row of rep.rows) {
        it(`${row.label}: expected ${row.expected} ${row.unit}`, () => {
          expect(row.error, row.error).toBeUndefined();
          const msg = `got ${row.got} ${row.unit}, expected ${row.expected} ${row.unit} (${row.errPct?.toFixed(3)} %, tolerance ${row.tolerance})`;
          expect(row.pass, msg).toBe(true);
        });
      }
    });
  }
}
