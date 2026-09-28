import { describe, it, expect } from 'vitest';
import { luFactor, luSolve, solve, SingularMatrixError } from './linalg';

describe('LU solver', () => {
  it('solves a 3x3 system', () => {
    const A = new Float64Array([2, 1, -1, -3, -1, 2, -2, 1, 2]);
    const b = new Float64Array([8, -11, -3]);
    const x = solve(A, b, 3);
    expect(x[0]).toBeCloseTo(2, 12);
    expect(x[1]).toBeCloseTo(3, 12);
    expect(x[2]).toBeCloseTo(-1, 12);
  });
  it('pivots when the first diagonal entry is zero', () => {
    const A = new Float64Array([0, 1, 1, 0]);
    const x = solve(A, new Float64Array([5, 7]), 2);
    expect(x[0]).toBeCloseTo(7);
    expect(x[1]).toBeCloseTo(5);
  });
  it('reuses a factorisation for several right-hand sides', () => {
    const f = luFactor(new Float64Array([4, 3, 6, 3]), 2);
    expect(luSolve(f, new Float64Array([10, 12]))[0]).toBeCloseTo(1);
    expect(luSolve(f, new Float64Array([7, 9]))[1]).toBeCloseTo(1);
  });
  it('reports a singular matrix instead of returning garbage', () => {
    expect(() => solve(new Float64Array([1, 2, 2, 4]), new Float64Array([1, 2]), 2)).toThrow(SingularMatrixError);
  });
});
