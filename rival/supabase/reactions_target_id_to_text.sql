-- Let reactions and comments attach to feed cards that aren't a single row.
--
-- feed_reactions.target_id and feed_comments.target_id are uuid, which assumes
-- every feed card is one database row. The daily walk rollup breaks that
-- assumption: it represents all of one person's auto-synced walks on one day,
-- so its id is "roll:<user_id>:<YYYY-MM-DD>" rather than an activities.id.
-- Widening target_type to accept 'day_roll' was not enough on its own — the
-- insert fails on the column type before any check runs.
--
-- Nothing else changes. There is no foreign key on these columns (targets
-- already span four different tables), so this is a widening only: every
-- existing uuid is a valid text value, and the unique constraint keeps working
-- because it is on (target_type, target_id, user_id) regardless of type.

begin;

alter table feed_reactions alter column target_id type text using target_id::text;
alter table feed_comments  alter column target_id type text using target_id::text;

commit;
