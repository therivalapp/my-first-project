-- Stop `users.email` being readable by every signed-in account.
--
-- RLS on users is `SELECT USING (true)` -- deliberately, so you can find and
-- follow people -- but that also made the email column world-readable to any
-- authenticated caller. The /friends search box was the convenient path to it
-- (fixed in the client), but the column itself was the actual exposure: a
-- direct PostgREST call could read every address regardless of the UI.
--
-- Email cannot simply be revoked today because it doubles as a DISPLAY-NAME
-- FALLBACK -- formatName.ts and identity.ts both fall back to
-- email.split('@')[0] when display_name is empty. So: fill the gap first,
-- then take the column away.

-- 1. Give every account a real display_name, so nothing needs the fallback.
update users
set display_name = split_part(email, '@', 1)
where display_name is null or trim(display_name) = '';

-- 2. Swap the table-wide SELECT for an explicit column list.
--    A column-level `revoke select (email)` does NOTHING while a table-wide
--    `GRANT SELECT ON users` stands -- the broad grant keeps satisfying the
--    check. The table grant has to go first, then the columns come back
--    individually.
--
--    date_of_birth is withheld for the same reason as email: sign-up collects
--    it, nothing reads it back, and `SELECT USING (true)` made every user's
--    birth date readable by every other user. Nobody has one stored yet, so
--    this costs nothing today and prevents a leak the moment someone does.
--
--    Own-profile email still works everywhere it is shown: profile.tsx reads
--    it from the auth session (`user.email`), not from this table.
revoke select on users from authenticated, anon;
grant select (
  id, display_name, avatar_url, created_at, last_active_at,
  is_admin, username, display_style, bio, quote_tone
) on users to authenticated;
grant select (
  id, display_name, avatar_url, username, display_style
) on users to anon;
