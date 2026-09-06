-- Chat: likes, replies, and read receipts.

-- 1. REPLIES. A message can quote the one it answers. ON DELETE SET NULL, not
--    CASCADE: deleting a message must not silently delete every reply to it.
alter table league_messages
  add column if not exists reply_to_id uuid references league_messages(id) on delete set null;

create index if not exists league_messages_reply_to_idx on league_messages(reply_to_id);

-- 2. LIKES. `kind` rather than a bare boolean so more reactions can be added
--    later without another migration. Unique per person per kind, so a double
--    tap can't stack.
create table if not exists league_message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references league_messages(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  kind text not null default 'like',
  created_at timestamptz not null default now(),
  unique (message_id, user_id, kind)
);

create index if not exists league_message_reactions_message_idx
  on league_message_reactions(message_id);

alter table league_message_reactions enable row level security;

-- Scoped through the message's league: you can see and add reactions only in
-- teams you are an ACTIVE member of.
drop policy if exists "members read message reactions" on league_message_reactions;
create policy "members read message reactions" on league_message_reactions
  for select using (
    exists (select 1 from league_messages m
             where m.id = message_id and is_league_member(m.league_id))
  );

drop policy if exists "members add own message reactions" on league_message_reactions;
create policy "members add own message reactions" on league_message_reactions
  for insert with check (
    auth.uid() = user_id
    and exists (select 1 from league_messages m
                 where m.id = message_id and is_league_member(m.league_id))
  );

drop policy if exists "members remove own message reactions" on league_message_reactions;
create policy "members remove own message reactions" on league_message_reactions
  for delete using (auth.uid() = user_id);

-- 3. READ RECEIPTS. league_chat_reads already stores last_read_at per person,
--    but SELECT was limited to your OWN row, so there was no way to know who
--    had seen a message. Teammates can now read each other's marker — scoped
--    to leagues they're both active in, nothing wider.
--
--    RLS is permissive (policies OR together), so this ADDS to the existing
--    own-row policy rather than replacing it; the own-row policy stays so your
--    own marker is readable even if membership lookup ever changes.
drop policy if exists "teammates read chat read state" on league_chat_reads;
create policy "teammates read chat read state" on league_chat_reads
  for select using (is_league_member(league_id));
