-- Two changes to league_messages, both about who is allowed to change a row.
--
-- 1. AUTHORS CAN EDIT THEIR OWN MESSAGES.
--    The table had policies for insert (members), select (members), delete
--    (own) and update (admins, to pin) — but nothing letting an ordinary
--    author update their own row. A planned session could be deleted and
--    re-posted, never corrected, and re-posting drops every RSVP on it.
--
-- 2. ANY TEAMMATE CAN PIN, NOT JUST ADMINS.
--    A team is a team; the chat doesn't need a captain. This is how Messenger
--    behaves in a normal group chat, and RIVAL's admin role exists to approve
--    who joins, not to curate what the team reads.
--
-- The hard part is that "anyone may pin any message" needs UPDATE access to
-- OTHER people's rows, and RLS is permissive — that same grant would let any
-- member rewrite anyone's message body. RLS alone can't say "you may change
-- this one column", because WITH CHECK cannot see the OLD row. So the column
-- rule lives in a trigger, and the policies only decide who gets in the door.

begin;

-- Superseded: pinning is no longer an admin-only act.
drop policy if exists "League admins can pin board messages" on public.league_messages;

create policy "Authors can edit own messages"
  on public.league_messages
  for update
  using (auth.uid() = user_id)
  -- Pins the row in place: it stays yours, and stays in a team you belong to.
  -- Without this an author could reassign their message to another league.
  with check (auth.uid() = user_id and is_league_member(league_id));

create policy "Team members can pin messages"
  on public.league_messages
  for update
  using (is_league_member(league_id))
  with check (is_league_member(league_id));

create or replace function public.guard_league_message_update()
returns trigger
language plpgsql
as $$
begin
  -- Anyone on the team may pin. Nobody but the author may change anything
  -- ELSE. Comparing whole rows minus `pinned` rather than listing columns, so
  -- a column added to this table later is protected by default instead of
  -- silently becoming editable by every teammate.
  if auth.uid() is distinct from old.user_id
     and (to_jsonb(new) - 'pinned') is distinct from (to_jsonb(old) - 'pinned') then
    raise exception 'Only the author can edit this message';
  end if;

  -- A chat message must not become a session (or a board post) after the fact.
  -- Every reader branches on `kind`, and RSVPs hang off session rows.
  if new.kind is distinct from old.kind then
    raise exception 'A message cannot change kind after posting';
  end if;

  return new;
end;
$$;

drop trigger if exists league_messages_guard_update on public.league_messages;
create trigger league_messages_guard_update
  before update on public.league_messages
  for each row execute function public.guard_league_message_update();

commit;
