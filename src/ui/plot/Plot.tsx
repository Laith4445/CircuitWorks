/**
 * Hand-rolled SVG plotter (SPEC §4.4 allows this instead of a library).
 * Features: autoscaling axes, linear or log x, min/max decimation for big
 * traces, a hover cursor with per-trace readouts, click to pin cursor A then
 * B with a Δ table, kept (ghost) traces.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatSI } from '../../engine/units';
import type { Trace } from '../traces';
import { valueAt } from '../traces';
import { decimate, linearTicks, logTicks, logRangeTicks } from './scale';

export interface PlotProps {
  traces: Trace[];
  xLabel: string;
  xUnit: string;
  yLabel: string;
  xLog?: boolean;
  yLog?: boolean;
  height?: number;
  /** cursor x shared with the schematic badges */
  onCursor?: (x: number | null) => void;
  cursors: { a: number | null; b: number | null };
  onCursors: (c: { a: number | null; b: number | null }) => void;
  /** lift the hover position so several panels share one cursor */
  hover?: number | null;
  onHover?: (x: number | null) => void;
  showTable?: boolean;
  /** shown at the right of the y ticks instead of the first trace's unit */
  yUnit?: string;
  /** zoomed x range (wheel to zoom, double-click to reset); lifted so panels can share it */
  xRange?: [number, number] | null;
  onXRange?: (r: [number, number] | null) => void;
}

const M = { l: 64, r: 16, t: 12, b: 30 };

function fmt(v: number, unit: string): string {
  if (unit === '°') return `${v.toFixed(1)}°`;
  if (unit === 'dB') return `${v.toFixed(2)} dB`;
  if (unit === '') return v.toPrecision(4);
  return formatSI(v, unit, 4);
}

export function Plot({ traces, xLabel, xUnit, yLabel, xLog, yLog, height = 240, onCursor, cursors, onCursors, hover: hoverProp, onHover, showTable = true, yUnit, xRange: xRangeProp, onXRange }: PlotProps) {
  const [xRangeLocal, setXRangeLocal] = useState<[number, number] | null>(null);
  const xRange = xRangeProp !== undefined ? xRangeProp : xRangeLocal;
  const setXRange = (r: [number, number] | null) => { setXRangeLocal(r); onXRange?.(r); };
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hoverLocal, setHoverLocal] = useState<number | null>(null);
  const hover = hoverProp !== undefined ? hoverProp : hoverLocal;
  const setHover = (x: number | null) => { setHoverLocal(x); onHover?.(x); };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const pw = Math.max(50, width - M.l - M.r), ph = Math.max(50, height - M.t - M.b);

  const scales = useMemo(() => {
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    for (const t of traces) {
      if (!t.x.length) continue;
      xmin = Math.min(xmin, t.x[0]); xmax = Math.max(xmax, t.x[t.x.length - 1]);
    }
    if (xRange) { xmin = xRange[0]; xmax = xRange[1]; }
    for (const t of traces) {
      for (let k = 0; k < t.y.length; k++) {
        if (t.x[k] < xmin || t.x[k] > xmax) continue;
        const v = t.y[k];
        if (!Number.isFinite(v)) continue;
        if (yLog && v <= 0) continue;
        if (v < ymin) ymin = v;
        if (v > ymax) ymax = v;
      }
    }
    if (!Number.isFinite(xmin)) { xmin = 0; xmax = 1; }
    if (!Number.isFinite(ymin)) { ymin = 0; ymax = 1; }
    const xt = xLog ? (xRange ? logRangeTicks(xmin, xmax) : logTicks(xmin, xmax)) : linearTicks(xmin, xmax, 6);
    const yt = yLog ? logTicks(ymin, ymax) : linearTicks(ymin, ymax, 5);
    const xlo = xLog && !xRange ? xt.lo : xmin, xhi = xLog && !xRange ? xt.hi : xmax;
    const sx = (x: number) => M.l + (xLog ? (Math.log10(x) - Math.log10(xlo)) / (Math.log10(xhi) - Math.log10(xlo) || 1) : (x - xlo) / (xhi - xlo || 1)) * pw;
    const sy = (y: number) => M.t + ph - (yLog ? (Math.log10(y) - Math.log10(yt.lo)) / (Math.log10(yt.hi) - Math.log10(yt.lo) || 1) : (y - yt.lo) / (yt.hi - yt.lo || 1)) * ph;
    const ix = (px: number) => {
      const f = (px - M.l) / pw;
      return xLog ? Math.pow(10, Math.log10(xlo) + f * (Math.log10(xhi) - Math.log10(xlo))) : xlo + f * (xhi - xlo);
    };
    return { xt, yt, sx, sy, ix, xlo, xhi };
  }, [traces, xLog, yLog, pw, ph, xRange]);

  const paths = useMemo(() => traces.map((t) => {
    const px = new Float64Array(t.x.length), py = new Float64Array(t.x.length);
    for (let k = 0; k < t.x.length; k++) { px[k] = scales.sx(t.x[k]); py[k] = scales.sy(t.y[k]); }
    const d = decimate(px, py, pw);
    let s = '';
    for (let k = 0; k < d.length; k += 2) {
      const x = d[k], y = d[k + 1];
      if (!Number.isFinite(y)) continue;
      s += (s ? 'L' : 'M') + x.toFixed(1) + ' ' + Math.max(-1e4, Math.min(1e4, y)).toFixed(1);
    }
    return s;
  }), [traces, scales, pw]);

  const clampX = (x: number) => Math.max(scales.xlo, Math.min(scales.xhi, x));
  const xAt = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return clampX(scales.ix(e.clientX - r.left));
  };

  const active = hover ?? cursors.a;
  useEffect(() => { onCursor?.(active); }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const cursorLine = (x: number, cls: string, tag: string) => (
    <g className={cls}>
      <line x1={scales.sx(x)} x2={scales.sx(x)} y1={M.t} y2={M.t + ph} />
      <text x={scales.sx(x) + 3} y={M.t + 10}>{tag}</text>
    </g>
  );

  const live = traces.filter((t) => !t.kept);
  const table = showTable && (cursors.a !== null || cursors.b !== null) && (
    <table className="cursor-table">
      <thead><tr><th></th>
        <th>A {cursors.a !== null ? `(${fmt(cursors.a, xUnit)})` : ''}</th>
        <th>B {cursors.b !== null ? `(${fmt(cursors.b, xUnit)})` : ''}</th>
        <th>Δ {cursors.a !== null && cursors.b !== null ? `(${fmt(cursors.b - cursors.a, xUnit)})` : ''}</th></tr></thead>
      <tbody>
        {live.map((t) => {
          const a = cursors.a !== null ? valueAt(t, cursors.a) : null;
          const b = cursors.b !== null ? valueAt(t, cursors.b) : null;
          return (
            <tr key={t.id}><td style={{ color: t.color }}>{t.label}</td>
              <td>{a !== null ? fmt(a, t.unit) : ''}</td><td>{b !== null ? fmt(b, t.unit) : ''}</td>
              <td>{a !== null && b !== null ? fmt(b - a, t.unit) : ''}</td></tr>
          );
        })}
      </tbody>
    </table>
  );

  return (
    <div className="plot" ref={ref}>
      <svg
        width={width} height={height}
        onMouseMove={(e) => setHover(xAt(e))}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          const x = xAt(e);
          if (cursors.a === null) onCursors({ a: x, b: null });
          else if (cursors.b === null) onCursors({ a: cursors.a, b: x });
          else onCursors({ a: x, b: null });
        }}
        onDoubleClick={() => { onCursors({ a: null, b: null }); setXRange(null); }}
        onWheel={(e) => {
          const x = xAt(e);
          const f = Math.exp(e.deltaY * 0.002);
          const lo = scales.xlo, hi = scales.xhi;
          let nlo: number, nhi: number;
          if (xLog) {
            const L = Math.log10;
            nlo = Math.pow(10, L(x) - (L(x) - L(lo)) * f);
            nhi = Math.pow(10, L(x) + (L(hi) - L(x)) * f);
          } else {
            nlo = x - (x - lo) * f;
            nhi = x + (hi - x) * f;
          }
          // never zoom out past the data
          let dmin = Infinity, dmax = -Infinity;
          for (const t of traces) if (t.x.length) { dmin = Math.min(dmin, t.x[0]); dmax = Math.max(dmax, t.x[t.x.length - 1]); }
          nlo = Math.max(nlo, dmin); nhi = Math.min(nhi, dmax);
          if (nhi <= nlo) return;
          setXRange(nlo >= dmin && nhi <= dmax && (nlo > dmin || nhi < dmax) ? [nlo, nhi] : null);
        }}
      >
        <rect x={M.l} y={M.t} width={pw} height={ph} className="plot-bg" />
        {scales.xt.ticks.map((v) => (
          <g key={`x${v}`} className="tick">
            <line x1={scales.sx(v)} x2={scales.sx(v)} y1={M.t} y2={M.t + ph} />
            <text x={scales.sx(v)} y={M.t + ph + 14} textAnchor="middle">{fmt(v, xUnit)}</text>
          </g>
        ))}
        {scales.yt.ticks.map((v) => (
          <g key={`y${v}`} className="tick">
            <line x1={M.l} x2={M.l + pw} y1={scales.sy(v)} y2={scales.sy(v)} />
            <text x={M.l - 6} y={scales.sy(v) + 3} textAnchor="end">{fmt(v, yUnit ?? live[0]?.unit ?? traces[0]?.unit ?? '')}</text>
          </g>
        ))}
        <text x={M.l + pw / 2} y={height - 4} textAnchor="middle" className="axis-label">{xLabel}</text>
        <text transform={`translate(12 ${M.t + ph / 2}) rotate(-90)`} textAnchor="middle" className="axis-label">{yLabel}</text>
        <clipPath id="plot-clip"><rect x={M.l} y={M.t} width={pw} height={ph} /></clipPath>
        <g clipPath="url(#plot-clip)">
          {traces.map((t, i) => (
            <path key={`${t.id}-${i}`} d={paths[i]} stroke={t.color} className={`trace${t.kept ? ' kept' : ''}`} />
          ))}
          {cursors.a !== null && cursorLine(cursors.a, 'cursor pinned', 'A')}
          {cursors.b !== null && cursorLine(cursors.b, 'cursor pinned', 'B')}
          {hover !== null && cursorLine(hover, 'cursor hover', '')}
          {hover !== null && live.map((t) => <circle key={t.id} cx={scales.sx(hover)} cy={scales.sy(valueAt(t, hover))} r={3} fill={t.color} />)}
        </g>
        <g className="legend" transform={`translate(${M.l + 8} ${M.t + 8})`}>
          {live.map((t, i) => (
            <g key={t.id} transform={`translate(0 ${i * 14})`}>
              <rect width={10} height={3} y={4} fill={t.color} />
              <text x={14} y={9} fill={t.color}>{t.label}{active !== null ? `: ${fmt(valueAt(t, active), t.unit)}` : ''}</text>
            </g>
          ))}
          {active !== null && <text x={0} y={live.length * 14 + 9} className="muted">{xLabel} = {fmt(active, xUnit)}</text>}
        </g>
      </svg>
      {table}
    </div>
  );
}
