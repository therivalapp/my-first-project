// Users type dates as YYYY-MM-DD — Canada's standard format, and the one the
// database already stores — so display and storage are the same shape and
// nothing has to be reordered at the UI boundary. It is also the only common
// format that can't be misread: 05-06 is ambiguous in both DD/MM and MM/DD,
// and RIVAL has users in countries that read it opposite ways.

// Auto-inserts the "-" separators as digits are typed, so a forgotten
// separator can never produce a string displayToIsoDate rejects in the first
// place. Recomputes from the raw digits on every keystroke rather than
// tracking cursor position, so backspacing anywhere in the string — including
// right on top of an inserted separator — just re-collapses to the same digits
// and reformats cleanly instead of getting stuck. Wire this as the
// onChangeText for every screen's own date TextInput.
export function maskDateInput(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  const year = digits.slice(0, 4);
  const month = digits.slice(4, 6);
  const day = digits.slice(6, 8);
  return [year, month, day].filter(Boolean).join('-');
}

export function isoToDisplayDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return '';
  return `${y}-${m}-${d}`;
}

// Returns null if the input isn't a valid YYYY-MM-DD date.
export function displayToIsoDate(display: string): string | null {
  const match = display.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  // Reject impossible dates (e.g. 2026-02-31) by round-tripping through Date.
  const check = new Date(year, month - 1, day);
  if (check.getFullYear() !== year || check.getMonth() !== month - 1 || check.getDate() !== day) return null;
  return iso;
}
