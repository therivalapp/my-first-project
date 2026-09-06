-- Team preview for people who are NOT members yet.
--
-- RLS on league_members is `is_league_member(league_id)`, so a non-member can
-- read nothing about a team but its name and logo. That had two costs:
--   1. Joining a public team was a blind leap -- no way to tell a living team
--      from an abandoned one.
--   2. The member count in discover-leagues was silently WRONG. It counted
--      league_members rows client-side, which RLS filters to teams you're
--      already in, so every public team you hadn't joined displayed "0".
--
-- These are SECURITY DEFINER so they can aggregate across the table without
-- exposing it -- the same pattern as lookup_league_by_invite_code. They return
-- COUNTS and first names only: never a roster, never an individual activity.
-- A preview should show whether a team is alive, not what its members did.

-- Counts for every public team, for the discovery list.
create or replace function get_public_team_counts()
returns table (league_id uuid, member_count bigint, sessions_last_7d bigint)
language sql
security definer
set search_path = public
as $$
  select l.id,
         (select count(*) from league_members m
           where m.league_id = l.id and m.status = 'active'),
         (select count(*) from activities a
           where a.user_id in (
             select m.user_id from league_members m
              where m.league_id = l.id and m.status = 'active')
             and a.started_at >= now() - interval '7 days')
    from leagues l
   where l.is_private = false;
$$;

-- Fuller preview for one public team.
create or replace function get_team_preview(p_league_id uuid)
returns table (
  id uuid, name text, logo_url text, created_at timestamptz,
  member_count bigint, sessions_last_7d bigint, member_names text[]
)
language sql
security definer
set search_path = public
as $$
  select l.id, l.name, l.logo_url, l.created_at,
         (select count(*) from league_members m
           where m.league_id = l.id and m.status = 'active'),
         (select count(*) from activities a
           where a.user_id in (
             select m.user_id from league_members m
              where m.league_id = l.id and m.status = 'active')
             and a.started_at >= now() - interval '7 days'),
         -- First names only, capped. Enough to recognise someone you know
         -- without handing a stranger the roster.
         (select array_agg(fn) from (
            select split_part(u.display_name, ' ', 1) as fn
              from league_members m join users u on u.id = m.user_id
             where m.league_id = l.id and m.status = 'active'
             order by m.joined_at
             limit 5) s)
    from leagues l
   -- Private teams are invite-only and must stay invisible: no row, no leak.
   where l.id = p_league_id and l.is_private = false;
$$;

revoke all on function get_public_team_counts() from public, anon;
revoke all on function get_team_preview(uuid) from public, anon;
grant execute on function get_public_team_counts() to authenticated;
grant execute on function get_team_preview(uuid) to authenticated;
