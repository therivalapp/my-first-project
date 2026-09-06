export type IdentityUser = {
  display_name: string | null;
  email?: string | null;
};

// Always the real display name — no username/display-style concept (removed
// 2026-08-31, was a source of "who is @masterchief" confusion on
// standings/leaderboards; everyone shows their real name everywhere now).
export function formatDisplayName(u: IdentityUser | null | undefined, fallback = 'Athlete'): string {
  if (!u) return fallback;
  return u.display_name || (u.email ? u.email.split('@')[0] : '') || fallback;
}

// Team names are free-typed by whoever created the team, so display them
// title-cased everywhere regardless of how they were entered
// ("squampton crreew" -> "Squampton Crreew"). Never store this — only the
// display layer title-cases, the DB keeps exactly what was typed.
export function formatTeamName(name: string | null | undefined): string {
  if (!name) return '';
  return name.replace(/\S+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1));
}

// Only uppercases each word's first letter — never lowercases the rest — so
// deliberate casing entered by the user (e.g. "NYC Marathon", "5K Trail Run")
// survives untouched. Same rule as formatTeamName, kept separate since race
// names and team names are conceptually distinct fields.
export function formatRaceName(name: string | null | undefined): string {
  if (!name) return '';
  return name.replace(/\S+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1));
}
