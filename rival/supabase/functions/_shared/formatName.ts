type IdentityUser = {
  display_name: string | null;
  email?: string | null;
};

// Mirrors rival/src/lib/identity.ts formatDisplayName — keep in sync.
export function formatDisplayName(u: IdentityUser | null | undefined, fallback = 'Someone'): string {
  if (!u) return fallback;
  return u.display_name || (u.email ? u.email.split('@')[0] : '') || fallback;
}

// Mirrors rival/src/lib/identity.ts formatTeamName — keep in sync.
export function formatTeamName(name: string | null | undefined): string {
  if (!name) return '';
  return name.replace(/\S+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1));
}
