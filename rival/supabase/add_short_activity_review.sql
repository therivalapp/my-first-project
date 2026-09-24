-- Remember that someone has already looked at a suspiciously short activity.
--
-- Very short auto-synced activities are usually accidents — a watch that lost
-- GPS and was restarted, a recording stopped seconds after it began. The app
-- asks the owner once whether to keep it, because only they know: Sandy's
-- 74-second "run" was her watch failing, and nothing in the data could say so.
--
-- Without somewhere to record the answer, "keep it" is not an answer — the
-- prompt would return on every app open forever, which is how a helpful
-- question becomes nagging. Set when the owner keeps it OR dismisses the
-- prompt; a removed activity is simply deleted.
--
-- Nullable with no default, so every existing row counts as "not yet asked"
-- and no backfill is needed.

begin;

alter table activities
  add column if not exists short_review_dismissed_at timestamptz;

-- Only ever queried as "my recent short activities I haven't answered for", so
-- the index covers exactly that shape and stays small by excluding the
-- overwhelming majority of rows, which are answered or long enough not to ask.
create index if not exists activities_short_review_idx
  on activities (user_id, started_at desc)
  where short_review_dismissed_at is null;

commit;
