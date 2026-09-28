/** The part palette: 13 parts + probes. Click to start placing; hotkeys shown. */
import type { PartType } from '../schematic/model';
import type { Action, Tool } from './state';
import { Symbol, PART_NAMES } from './symbols';

const ITEMS: { type: PartType; key?: string }[] = [
  { type: 'R', key: 'R' }, { type: 'C', key: 'C' }, { type: 'L', key: 'L' }, { type: 'GND', key: 'G' },
  { type: 'Vdc', key: 'V' }, { type: 'Idc', key: 'I' }, { type: 'Vwave' },
  { type: 'VCVS' }, { type: 'VCCS' }, { type: 'CCVS' }, { type: 'CCCS' },
  { type: 'OPAMP', key: 'O' }, { type: 'SW', key: 'S' },
];

export function Palette({ tool, dispatch }: { tool: Tool; dispatch: (a: Action) => void }) {
  const placing = tool.kind === 'place' ? tool.type : null;
  return (
    <aside className="palette">
      <h2>Parts</h2>
      {ITEMS.map((it) => (
        <button
          key={it.type}
          className={`palette-item${placing === it.type ? ' active' : ''}`}
          title={`${PART_NAMES[it.type]}${it.key ? ` (${it.key})` : ''}`}
          onClick={() => dispatch({ type: 'setTool', tool: placing === it.type ? { kind: 'select' } : { kind: 'place', type: it.type, rot: it.type === 'GND' || it.type === 'OPAMP' ? 0 : 0, flip: false } })}
        >
          <svg viewBox="-34 -24 68 48" width={56} height={34}>
            <g transform={it.type === 'GND' ? 'translate(0 -8)' : undefined}><Symbol part={{ id: it.type, type: it.type, x: 0, y: 0, rot: 0, params: it.type === 'SW' ? { init: 'closed' } : undefined }} /></g>
          </svg>
          <span>{PART_NAMES[it.type]}</span>
          {it.key && <kbd>{it.key}</kbd>}
        </button>
      ))}
      <h2>Wire &amp; probes</h2>
      <button className={`palette-item${tool.kind === 'wire' ? ' active' : ''}`} title="Wire (W) — or click a pin and drag"
        onClick={() => dispatch({ type: 'setTool', tool: tool.kind === 'wire' ? { kind: 'select' } : { kind: 'wire', points: [] } })}>
        <svg viewBox="-34 -24 68 48" width={56} height={34}><path d="M-24 8 H0 V-8 H24" stroke="currentColor" strokeWidth={1.8} fill="none" /></svg>
        <span>Wire</span><kbd>W</kbd>
      </button>
      <button className={`palette-item${tool.kind === 'probe' && tool.probeKind === 'v' ? ' active' : ''}`} title="Voltage probe (P): drop on a wire or pin; drag its ○ to another point for a differential reading"
        onClick={() => dispatch({ type: 'setTool', tool: { kind: 'probe', probeKind: 'v' } })}>
        <svg viewBox="-34 -24 68 48" width={56} height={34}><circle cx={-6} cy={4} r={7} fill="#1d4ed8" /><text x={-6} y={8} fontSize={10} fill="#fff" textAnchor="middle">V</text><circle cx={14} cy={-8} r={5} fill="none" stroke="#1d4ed8" strokeDasharray="2 2" /></svg>
        <span>Voltage probe</span><kbd>P</kbd>
      </button>
      <button className={`palette-item${tool.kind === 'probe' && tool.probeKind === 'i' ? ' active' : ''}`} title="Current probe: drop on a part; click the arrow to flip its direction"
        onClick={() => dispatch({ type: 'setTool', tool: { kind: 'probe', probeKind: 'i' } })}>
        <svg viewBox="-34 -24 68 48" width={56} height={34}><path d="M-16 0 H16 M8 -6 L16 0 L8 6" stroke="#c2410c" strokeWidth={2.2} fill="none" /></svg>
        <span>Current probe</span>
      </button>
      <button className={`palette-item${tool.kind === 'probe' && tool.probeKind === 'p' ? ' active' : ''}`} title="Power probe: drop on a part; shows power absorbed by it"
        onClick={() => dispatch({ type: 'setTool', tool: { kind: 'probe', probeKind: 'p' } })}>
        <svg viewBox="-34 -24 68 48" width={56} height={34}><circle cx={0} cy={0} r={8} fill="#15803d" /><text x={0} y={4} fontSize={10} fill="#fff" textAnchor="middle">P</text></svg>
        <span>Power probe</span>
      </button>
    </aside>
  );
}
