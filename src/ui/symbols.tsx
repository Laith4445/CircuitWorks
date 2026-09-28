/** SVG drawings for each part type, in local coordinates at rotation 0 (pins at ±20,0). */
import type { Part, PartType } from '../schematic/model';

const stroke = { stroke: 'currentColor', strokeWidth: 1.6, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

function Zigzag() {
  return <path {...stroke} d="M-20 0 H-14 L-11 -5 L-5 5 L1 -5 L7 5 L11 -5 L14 0 H20" />;
}
function Cap() {
  return <g {...stroke}><path d="M-20 0 H-3 M3 0 H20" /><path d="M-3 -8 V8 M3 -8 V8" /></g>;
}
function Ind() {
  return <path {...stroke} d="M-20 0 H-15 A5 5 0 0 1 -5 0 A5 5 0 0 1 5 0 A5 5 0 0 1 15 0 H20" />;
}
function Circle() {
  return <circle {...stroke} cx={0} cy={0} r={10} />;
}
function Diamond() {
  return <path {...stroke} d="M-10 0 L0 -10 L10 0 L0 10 Z" />;
}
function Leads() {
  return <path {...stroke} d="M-20 0 H-10 M10 0 H20" />;
}
function PlusMinus() {
  return <g {...stroke} strokeWidth={1.4}><path d="M-6 0 H-2 M-4 -2 V2" /><path d="M2 0 H6" /></g>;
}
function Arrow() {
  return <path {...stroke} d="M-6 0 H6 M3 -3 L6 0 L3 3" />;
}
function Sine() {
  return <path {...stroke} strokeWidth={1.2} d="M-6 0 Q-3 -6 0 0 T6 0" />;
}
function Switch({ closed }: { closed: boolean }) {
  return (
    <g {...stroke}>
      <path d="M-20 0 H-10 M10 0 H20" />
      <circle cx={-10} cy={0} r={1.5} fill="currentColor" />
      <circle cx={10} cy={0} r={1.5} fill="currentColor" />
      {closed ? <path d="M-10 0 H10" /> : <path d="M-10 0 L9 -9" />}
    </g>
  );
}
function Ground() {
  return <path {...stroke} d="M0 0 V8 M-8 8 H8 M-5 12 H5 M-2 16 H2" />;
}
function Opamp() {
  return (
    <g {...stroke}>
      <path d="M-30 -10 H-24 M-30 10 H-24 M24 0 H30" />
      <path d="M-24 -20 V20 L24 0 Z" />
      <path strokeWidth={1.3} d="M-20 -10 H-14 M-17 -13 V-7 M-20 10 H-14" />
    </g>
  );
}

export function Symbol({ part }: { part: Part }) {
  const t: PartType = part.type;
  switch (t) {
    case 'R': return <Zigzag />;
    case 'C': return <Cap />;
    case 'L': return <Ind />;
    case 'GND': return <Ground />;
    case 'Vdc': return <g><Leads /><Circle /><PlusMinus /></g>;
    case 'Idc': return <g><Leads /><Circle /><Arrow /></g>;
    case 'Vwave': return <g><Leads /><Circle /><Sine /><path {...stroke} strokeWidth={1.2} d="M-15 -6 H-11 M-13 -8 V-4" /></g>;
    case 'VCVS': case 'CCVS': return <g><Leads /><Diamond /><PlusMinus /></g>;
    case 'VCCS': case 'CCCS': return <g><Leads /><Diamond /><Arrow /></g>;
    case 'OPAMP': return <Opamp />;
    case 'SW': return <Switch closed={(part.params?.init ?? 'open') === 'closed'} />;
  }
}

export const PART_NAMES: Record<PartType, string> = {
  R: 'Resistor', C: 'Capacitor', L: 'Inductor', GND: 'Ground', Vdc: 'DC voltage source', Idc: 'DC current source',
  Vwave: 'Waveform source', VCVS: 'Voltage-controlled voltage source', VCCS: 'Voltage-controlled current source',
  CCVS: 'Current-controlled voltage source', CCCS: 'Current-controlled current source', OPAMP: 'Ideal op amp', SW: 'Switch',
};

/** Short names for the palette (the full name is the tooltip). */
export const SHORT_NAMES: Record<PartType, string> = {
  R: 'Resistor', C: 'Capacitor', L: 'Inductor', GND: 'Ground', Vdc: 'DC voltage', Idc: 'DC current',
  Vwave: 'Waveform', VCVS: 'VCVS', VCCS: 'VCCS', CCVS: 'CCVS', CCCS: 'CCCS', OPAMP: 'Op amp', SW: 'Switch',
};

export const HOTKEYS: Record<string, PartType> = { r: 'R', c: 'C', l: 'L', g: 'GND', v: 'Vdc', i: 'Idc', o: 'OPAMP', s: 'SW' };

/** The value string a part shows on the schematic. */
export function displayValue(part: Part): string {
  const p = part.params ?? {};
  switch (part.type) {
    case 'R': return `${p.R ?? ''}Ω`;
    case 'C': return `${p.C ?? ''}F`;
    case 'L': return `${p.L ?? ''}H`;
    case 'Vdc': return `${p.V ?? ''}V`;
    case 'Idc': return `${p.I ?? ''}A`;
    case 'Vwave': return p.type === 'sine' ? `sine ${p.va ?? ''}V pk ${p.f ?? ''}Hz` : p.type === 'step' ? `step ${p.v1 ?? ''}→${p.v2 ?? ''}V` : `pulse ${p.v1 ?? ''}→${p.v2 ?? ''}V`;
    case 'VCVS': case 'CCVS': case 'VCCS': case 'CCCS': return `×${p.gain ?? ''} (${p.ctrl || '?'})`;
    case 'SW': return (p.toggle ?? 'true') === 'false' ? (p.init === 'closed' ? 'closed' : 'open') : p.init === 'closed' ? 'closed, opens at t=0' : 'open, closes at t=0';
    default: return '';
  }
}

/** Which param is the "main value" for inline editing. */
export function mainParam(type: PartType): string | null {
  switch (type) {
    case 'R': return 'R'; case 'C': return 'C'; case 'L': return 'L'; case 'Vdc': return 'V'; case 'Idc': return 'I';
    case 'VCVS': case 'CCVS': case 'VCCS': case 'CCCS': return 'gain';
    default: return null;
  }
}
