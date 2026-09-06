-- Reverts supabase/identity.sql — Ricky decided against the username/
-- display-style concept entirely (2026-08-31): everyone shows their real
-- name everywhere now, no username, no per-user display preference. The app
-- code no longer reads or writes either column (see src/lib/identity.ts).

alter table users drop constraint if exists username_format_check;
alter table users drop constraint if exists display_style_check;

alter table users drop column if exists username;
alter table users drop column if exists display_style;
