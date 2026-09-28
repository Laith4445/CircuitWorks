import { describe, it, expect } from 'vitest';
import { parseValue, formatSI } from './units';

describe('parseValue', () => {
  const cases: [string, number][] = [
    ['10', 10], ['4.7k', 4700], ['10u', 1e-5], ['3.3mH', 3.3e-3], ['10 kΩ', 1e4], ['4.7uF', 4.7e-6],
    ['25.33p', 25.33e-12], ['1MEG', 1e6], ['1meg', 1e6], ['10M', 1e7], ['5m', 5e-3], ['1MHz', 1e6],
    ['1ms', 1e-3], ['1us', 1e-6], ['1µs', 1e-6], ['2ms', 2e-3], ['1G', 1e9], ['1e-3', 1e-3], ['-3.5', -3.5], ['.5', 0.5],
    ['1F', 1], ['1H', 1], ['1 Hz', 1], ['10 ohm', 10],
  ];
  for (const [s, v] of cases) {
    it(`"${s}" -> ${v}`, () => { expect(parseValue(s)).toBeCloseTo(v, 15); });
  }
  it('M means mega, m means milli', () => {
    expect(parseValue('1M')).toBe(1e6);
    expect(parseValue('1m')).toBe(1e-3);
  });
  it('rejects nonsense with a plain message', () => {
    expect(() => parseValue('ten')).toThrow(/isn't a number/);
    expect(() => parseValue('10x')).toThrow();
  });
});

describe('formatSI', () => {
  it('shows 3 significant figures with a prefix', () => {
    expect(formatSI(0.8695652, 'V')).toBe('870 mV');
    expect(formatSI(18.0000001, 'V')).toBe('18 V');
    expect(formatSI(0.0001, 'A')).toBe('100 µA');
    expect(formatSI(4.385e-7, 'W')).toBe('439 nW');
    expect(formatSI(-3.369, 'V')).toBe('-3.37 V');
    expect(formatSI(1e6, 'Hz')).toBe('1 MHz');
  });
});
