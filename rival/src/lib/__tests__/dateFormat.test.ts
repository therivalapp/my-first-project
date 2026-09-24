import { describe, it, expect } from 'vitest';
import { isoToDisplayDate, displayToIsoDate, maskDateInput } from '../dateFormat';

describe('displayToIsoDate', () => {
  it('accepts YYYY-MM-DD', () => {
    expect(displayToIsoDate('2026-12-25')).toBe('2026-12-25');
    expect(displayToIsoDate('2026-01-01')).toBe('2026-01-01');
  });

  it('pads single-digit months and days', () => {
    expect(displayToIsoDate('2026-1-1')).toBe('2026-01-01');
  });

  it('rejects impossible dates', () => {
    expect(displayToIsoDate('2026-02-31')).toBeNull(); // Feb 31
    expect(displayToIsoDate('2026-02-29')).toBeNull(); // 2026 not a leap year
    expect(displayToIsoDate('2026-06-00')).toBeNull();
    expect(displayToIsoDate('2026-01-32')).toBeNull();
    expect(displayToIsoDate('2026-13-15')).toBeNull();
  });

  it('accepts leap-day on real leap years', () => {
    expect(displayToIsoDate('2028-02-29')).toBe('2028-02-29');
  });

  it('rejects malformed input', () => {
    expect(displayToIsoDate('25/12/2026')).toBeNull(); // the old display format
    expect(displayToIsoDate('25-12-2026')).toBeNull(); // day-first, not year-first
    expect(displayToIsoDate('')).toBeNull();
    expect(displayToIsoDate('banana')).toBeNull();
  });
});

describe('isoToDisplayDate', () => {
  it('passes a stored date straight through', () => {
    expect(isoToDisplayDate('2026-12-25')).toBe('2026-12-25');
  });

  it('returns empty for an incomplete date', () => {
    expect(isoToDisplayDate('2026-12')).toBe('');
    expect(isoToDisplayDate('')).toBe('');
  });

  it('round-trips with displayToIsoDate', () => {
    for (const iso of ['2026-01-01', '2026-12-31', '2028-02-29']) {
      expect(displayToIsoDate(isoToDisplayDate(iso)!)).toBe(iso);
    }
  });
});

describe('maskDateInput', () => {
  it('inserts separators as digits are typed', () => {
    expect(maskDateInput('2')).toBe('2');
    expect(maskDateInput('2026')).toBe('2026');
    expect(maskDateInput('20261')).toBe('2026-1');
    expect(maskDateInput('2026122')).toBe('2026-12-2');
    expect(maskDateInput('20261225')).toBe('2026-12-25');
  });

  it('ignores separators the user types themselves', () => {
    expect(maskDateInput('2026-12-25')).toBe('2026-12-25');
    expect(maskDateInput('2026/12/25')).toBe('2026-12-25');
  });

  it('drops anything past eight digits', () => {
    expect(maskDateInput('202612259999')).toBe('2026-12-25');
  });

  it('collapses cleanly when backspacing onto a separator', () => {
    expect(maskDateInput('2026-12-')).toBe('2026-12');
    expect(maskDateInput('2026-')).toBe('2026');
  });

  it('produces something displayToIsoDate accepts', () => {
    expect(displayToIsoDate(maskDateInput('20261225'))).toBe('2026-12-25');
  });
});
