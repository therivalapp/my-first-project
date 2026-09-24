-- An in-app inbox whose items can be acted on where they sit.
--
-- The existing `notifications` table is push-send bookkeeping (user, type,
-- league, matchup, sent_at) — no message, no read state, no way to act on
-- anything. It stays as it is; this is a different thing beside it.
--
-- Items are ACTIONABLE, not just informational: approve a join request, keep or
-- remove a mistaken activity, without leaving the list. That is why an item
-- records what it acts on (subject_type/subject_id) and how it ended
-- (resolution), rather than being a line of text and a link.
--
-- Items are written by TRIGGERS, never by the client. Reactions and comments
-- are client inserts, so letting the app create inbox rows for OTHER people
-- would mean granting it insert-for-anyone — which is a spam primitive. A
-- SECURITY DEFINER trigger can write the recipient's row without the sender
-- ever holding that permission.

begin;

create table if not exists inbox_items (
  id uuid primary key default uuid_generate_v4(),

  -- Who this is for.
  user_id uuid not null references users(id) on delete cascade,

  -- What happened. The client maps this to a title, an icon and the set of
  -- actions offered, so adding a kind never needs a migration.
  kind text not null check (kind in (
    'reaction', 'comment', 'join_request', 'short_activity', 'team_joined'
  )),

  -- Who caused it. Null for anything the system noticed by itself, such as a
  -- suspiciously short activity.
  actor_id uuid references users(id) on delete set null,
  league_id uuid references leagues(id) on delete cascade,

  -- What an action would act on. Text, not uuid, for the same reason
  -- feed_reactions.target_id is: some subjects are synthetic and span several
  -- rows (a day's walk rollup is "roll:<user>:<date>").
  subject_type text,
  subject_id text,

  -- Rendered when the item is created rather than assembled on read, so an
  -- item still reads correctly after the thing it describes changes or goes.
  title text not null,
  body text,

  read_at timestamptz,

  -- Separate from read_at on purpose: reading an item is not answering it. An
  -- item with actions stays open until acted on or dismissed.
  resolved_at timestamptz,
  resolution text check (resolution in ('acted', 'dismissed', 'expired')),

  created_at timestamptz not null default now()
);

-- The only two queries the inbox makes: the unread badge count, and the list
-- itself. Partial, so it stays small as resolved items accumulate.
create index if not exists inbox_items_unread_idx
  on inbox_items (user_id, created_at desc)
  where read_at is null;

create index if not exists inbox_items_list_idx
  on inbox_items (user_id, created_at desc);

-- One item per person per event. Without this, re-reacting after an undo
-- would pile up duplicates for the recipient.
create unique index if not exists inbox_items_dedup_idx
  on inbox_items (user_id, kind, coalesce(subject_id, ''), coalesce(actor_id, user_id));

alter table inbox_items enable row level security;

-- Yours to read, yours to mark read or resolved. Nobody writes these directly:
-- inserts come from SECURITY DEFINER triggers, which bypass RLS.
drop policy if exists "Read own inbox" on inbox_items;
create policy "Read own inbox" on inbox_items
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Update own inbox" on inbox_items;
create policy "Update own inbox" on inbox_items
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Delete own inbox" on inbox_items;
create policy "Delete own inbox" on inbox_items
  for delete to authenticated
  using (user_id = auth.uid());

commit;
