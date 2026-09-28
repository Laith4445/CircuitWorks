import { describe, it, expect } from 'vitest';
import { encodeCircuit, decodeCircuit, toFileJson, migrate, circuitFromHash, URL_WARN_BYTES } from './url';
import { EXERCISES } from '../exercises';
import type { Circuit } from '../schematic/model';

describe('URL sharing', () => {
  for (const ex of EXERCISES) {
    it(`${ex.exercise.id}: JSON -> URL -> JSON is byte-exact and under the size limit`, async () => {
      const circuit: Circuit = { ...ex };
      const s = await encodeCircuit(circuit);
      expect(s.length).toBeLessThan(URL_WARN_BYTES);
      expect(s.length).toBeLessThan(2048);
      const back = await decodeCircuit(s);
      expect(toFileJson(back)).toBe(toFileJson(circuit));
    });
  }
  it('in-memory wire ids are not written to the file', () => {
    const c: Circuit = { v: 1, grid: 10, parts: [], wires: [{ from: [0, 0], to: [10, 0], id: 'w1' }], probes: [], analysis: { kind: 'dc' }, labels: [] };
    expect(toFileJson(c)).not.toContain('w1');
  });
  it('older files without v / probes / labels still load', () => {
    const c = migrate({ parts: [{ id: 'R1', type: 'R', x: 0, y: 0 }], wires: [] });
    expect(c.v).toBe(1);
    expect(c.parts[0].rot).toBe(0);
    expect(c.probes).toEqual([]);
    expect(c.analysis).toEqual({ kind: 'dc' });
  });
  it('rejects garbage with a plain message', () => {
    expect(() => migrate({ hello: 1 })).toThrow(/not a circuit file/);
    expect(() => migrate({ v: 9, parts: [], wires: [] })).toThrow(/newer version/);
  });
  it('reads the circuit from the URL fragment', () => {
    expect(circuitFromHash('#c=abc_-1')).toBe('abc_-1');
    expect(circuitFromHash('#/selfcheck')).toBeNull();
  });
});
