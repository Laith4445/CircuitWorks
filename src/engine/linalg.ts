/**
 * Dense LU decomposition with partial pivoting, hand-written so the solver
 * has no dependencies. Matrices are row-major Float64Array of size n*n.
 */

export interface LU {
  n: number;
  lu: Float64Array;
  perm: Int32Array;
  /** Smallest |pivot| relative to the largest entry of its column before pivoting. */
  minPivot: number;
  minPivotRow: number;
}

export class SingularMatrixError extends Error {
  constructor(public row: number, public pivot: number) {
    super(`matrix is singular (row ${row}, pivot ${pivot})`);
    this.name = 'SingularMatrixError';
  }
}

export function luFactor(A: Float64Array, n: number, tol = 1e-13): LU {
  const lu = new Float64Array(A);
  const perm = new Int32Array(n);
  for (let i = 0; i < n; i++) perm[i] = i;
  let minPivot = Infinity;
  let minPivotRow = -1;

  // Row scaling for the pivot test only (so tiny gmin rows don't false-alarm).
  const scale = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let j = 0; j < n; j++) m = Math.max(m, Math.abs(A[i * n + j]));
    scale[i] = m === 0 ? 1 : m;
  }

  for (let k = 0; k < n; k++) {
    // find pivot
    let p = k;
    let best = Math.abs(lu[k * n + k]) / scale[perm[k]];
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(lu[i * n + k]) / scale[perm[i]];
      if (v > best) { best = v; p = i; }
    }
    if (p !== k) {
      for (let j = 0; j < n; j++) {
        const t = lu[k * n + j]; lu[k * n + j] = lu[p * n + j]; lu[p * n + j] = t;
      }
      const t = perm[k]; perm[k] = perm[p]; perm[p] = t;
    }
    const piv = lu[k * n + k];
    if (best < minPivot) { minPivot = best; minPivotRow = perm[k]; }
    if (!(best > tol)) throw new SingularMatrixError(perm[k], piv);
    const inv = 1 / piv;
    for (let i = k + 1; i < n; i++) {
      const f = lu[i * n + k] * inv;
      if (f === 0) continue;
      lu[i * n + k] = f;
      for (let j = k + 1; j < n; j++) lu[i * n + j] -= f * lu[k * n + j];
    }
  }
  return { n, lu, perm, minPivot, minPivotRow };
}

export function luSolve(f: LU, b: Float64Array, out?: Float64Array): Float64Array {
  const { n, lu, perm } = f;
  const x = out ?? new Float64Array(n);
  // forward: L y = P b
  for (let i = 0; i < n; i++) {
    let s = b[perm[i]];
    for (let j = 0; j < i; j++) s -= lu[i * n + j] * x[j];
    x[i] = s;
  }
  // back: U x = y
  for (let i = n - 1; i >= 0; i--) {
    let s = x[i];
    for (let j = i + 1; j < n; j++) s -= lu[i * n + j] * x[j];
    x[i] = s / lu[i * n + i];
  }
  return x;
}

/** Convenience: solve A x = b once. */
export function solve(A: Float64Array, b: Float64Array, n: number): Float64Array {
  return luSolve(luFactor(A, n), b);
}
