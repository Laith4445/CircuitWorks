import { describe, it, expect } from 'vitest';
import { EXERCISES } from './index';
import { grade, targetsFor } from './grade';
import type { Circuit } from '../schematic/model';

describe('try-it-yourself grading', () => {
  for (const file of EXERCISES) {
    it(`${file.exercise.id}: the worked example passes every target`, () => {
      const g = grade(file, file as Circuit);
      expect(g.error).toBeUndefined();
      const failed = g.rows.filter((r) => !r.pass).map((r) => `${r.label}: got ${r.got} (${r.hint})`);
      expect(failed).toEqual([]);
      expect(g.passed).toBe(targetsFor(file).length);
    });
  }
  it('an empty drawing gets a plain message, not a crash', () => {
    const file = EXERCISES[0];
    const g = grade(file, { v: 1, grid: 10, parts: [], wires: [], probes: [], analysis: { kind: 'dc' }, labels: [] });
    expect(g.error).toMatch(/drawing is empty/);
    expect(g.passed).toBe(0);
  });
  it('a wrong resistor value fails with a helpful hint, and a flipped probe is called out', () => {
    const file = EXERCISES[0];
    const wrong: Circuit = JSON.parse(JSON.stringify(file));
    wrong.parts.find((p) => p.id === 'R3')!.params!.R = '150';
    const g = grade(file, wrong);
    expect(g.passed).toBeLessThan(g.total);
    expect(g.rows[0].hint).toMatch(/Closest probe/);
    const flipped: Circuit = JSON.parse(JSON.stringify(file));
    const p1 = flipped.probes.find((p) => p.id === 'P1')!;
    [p1.nodeAt, p1.refAt] = [p1.refAt, p1.nodeAt];
    const g2 = grade(file, flipped);
    expect(g2.rows.find((r) => r.label.startsWith('V_out'))!.hint).toMatch(/wrong sign/);
  });
  it('grading uses the exercise analysis even if the student left the DC tab selected', () => {
    const file = EXERCISES.find((e) => e.exercise.id === 'E4')!;
    const c: Circuit = { ...(JSON.parse(JSON.stringify(file)) as Circuit), analysis: { kind: 'dc' } };
    expect(grade(file, c).passed).toBe(grade(file, file as Circuit).total);
  });
});
