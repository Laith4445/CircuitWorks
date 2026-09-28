/**
 * Value parsing and formatting. "4.7k" -> 4700, "10u" -> 1e-5, "3.3mH" -> 3.3e-3.
 * Decision (SPEC §4.2, §9.6): "M" means MEGA in this app, "m" means milli.
 */

const SUFFIX: Record<string, number> = {
  T: 1e12, G: 1e9, MEG: 1e6, M: 1e6, k: 1e3, K: 1e3,
  m: 1e-3, u: 1e-6, 'µ': 1e-6, 'μ': 1e-6, n: 1e-9, p: 1e-12, f: 1e-15,
};

const UNITS = new Set(['', 'Ω', 'ohm', 'ohms', 'F', 'H', 'V', 'A', 'Hz', 's', 'sec', 'S', 'W', 'deg', '°', 'rad']);

const RE = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([Mm][Ee][Gg]|[TGMkKmuµμnpf])?\s*([A-Za-zΩ°]*)\s*$/;

/** Parse a user value string. Throws a plain-language Error if it can't. */
export function parseValue(s: string | number): number {
  if (typeof s === 'number') return s;
  const m = RE.exec(s);
  if (!m) throw new Error(`"${s}" isn't a number I understand (try 10, 4.7k, 10u, 3.3mH).`);
  let [, num, suf, unit] = m;
  suf = suf ?? '';
  unit = unit ?? '';
  // "1F", "1H", "1Hz": the regex may have swallowed a unit letter as a suffix
  // only if it is a suffix letter; farad/henry/hertz aren't, so no ambiguity.
  if (suf.length === 3) suf = 'MEG';
  if (!UNITS.has(unit)) {
    // Allow things like "kohm" where the suffix got captured and the unit is odd.
    throw new Error(`"${s}": I don't recognise the unit "${unit}".`);
  }
  const mult = suf === '' ? 1 : SUFFIX[suf];
  if (mult === undefined) throw new Error(`"${s}": unknown multiplier "${suf}".`);
  return parseFloat(num) * mult;
}

/** Plain-language description of how a string was read, e.g. "10M = 10 000 000". */
export function describeValue(s: string, unit = ''): string {
  try {
    const v = parseValue(s);
    return `${s} = ${formatSI(v, unit)}`;
  } catch (e) {
    return (e as Error).message;
  }
}

const PREFIXES: [number, string][] = [
  [1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''],
  [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f'],
];

/** 3 significant figures with an SI prefix: 0.8695652 -> "870 mV". */
export function formatSI(x: number, unit = '', sig = 3): string {
  if (!Number.isFinite(x)) return String(x);
  if (x === 0) return `0 ${unit}`.trim();
  const ax = Math.abs(x);
  let mult = 1e-15, pre = 'f';
  for (const [m, p] of PREFIXES) {
    if (ax >= m * 0.9995) { mult = m; pre = p; break; }
  }
  if (ax < 1e-15) { mult = 1e-15; pre = 'f'; }
  const scaled = x / mult;
  const s = Number(scaled.toPrecision(sig));
  return `${s} ${pre}${unit}`.trim();
}
