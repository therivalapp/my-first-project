-- Let the feed's daily rollup cards carry reactions and comments.
--
-- Short auto-synced activities now gather into one card per person per day
-- instead of a feed row each. That card's target id is synthetic
-- ("roll:<user_id>:<YYYY-MM-DD>") rather than an activities.id, and its
-- target_type is 'day_roll' — which the existing CHECK rejects, so the card
-- currently renders with its reaction row inert.
--
-- Widening the constraint is all that's needed: target_id is already text and
-- carries no foreign key, because these targets span several rows rather than
-- pointing at one.

begin;

alter table feed_reactions drop constraint if exists feed_reactions_target_type_check;
alter table feed_reactions add constraint feed_reactions_target_type_check
  check (target_type = any (array['activity', 'race', 'session', 'board', 'day_roll']));

alter table feed_comments drop constraint if exists feed_comments_target_type_check;
alter table feed_comments add constraint feed_comments_target_type_check
  check (target_type = any (array['activity', 'race', 'session', 'board', 'day_roll']));

commit;
