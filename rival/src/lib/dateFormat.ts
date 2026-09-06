// Users type dates as DD/MM/YYYY; the database and every date comparison in
// the app (gte/lte on `date` columns) needs ISO YYYY-MM-DD. These convert
// between the two at the UI boundary only — never store display-format dates.

// Auto-inserts the "/" separators as digits are typed, so a forgotten slash
// can never produce a string displayToIsoDate rejects in the first place —
// the exact bug Ricky flagged (typed "02092026", got "Enter the date as
// DD/MM/YYYY" with no indication what was wrong). Recomputes from the raw
// digits on every keystroke rather than tracking cursor position, so
// backspacing anywhere in the string — including right on top of an
// inserted slash — just re-collapses to the same digits and reformats
// cleanly instead of getting stuck. Wire this as the onChangeText for every
// screen's own DD/MM/YYYY TextInput.
export function maskDateInput(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  const day = digits.slice(0, 2);
  const month = digits.slice(2, 4);
  const year = digits.slice(4, 8);
  return [day, month, year].filter(Boolean).join('/');
}

export function isoToDisplayDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return '';
  return `${d}/${m}/${y}`;
}

// Returns null if the input isn't a valid DD/MM/YYYY date.
export function displayToIsoDate(display: string): string | null {
  const match = display.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  // Reject impossible dates (e.g. 31/02/2026) by round-tripping through Date.
  const check = new Date(year, month - 1, day);
  if (check.getFullYear() !== year || check.getMonth() !== month - 1 || check.getDate() !== day) return null;
  return iso;
}
