-- Collapse duplicate activity_type spellings and re-level the class-format
-- multipliers. Companion to _shared/activityType.ts, which stops NEW imports
-- creating these duplicates; this cleans up what's already stored.

-- 1. Re-map existing rows onto the canonical spelling.
update activities set activity_type = 'CrossFit' where activity_type = 'Crossfit';
update activities set activity_type = 'Rowing'   where activity_type = 'Row';

-- 2. Drop the now-unused alias config rows. One sport, one tuning knob —
--    two rows means half the workouts silently miss a change made to the other.
delete from scoring_config where activity_type in ('Crossfit', 'Row');

-- 3. Re-level the class-format sports.
--    They share a scoring problem: logged duration is CLASS time, which
--    includes warm-up, skill work and coaching, not just working time. That
--    is already priced in below Run (1.2 for genuinely continuous work).
--
--    Hyrox 1.5 -> 1.3: 1.5 was priced for a Hyrox RACE (90 min continuous,
--    8km of running between 8 stations, no rest). But almost everything
--    logged as "Hyrox" is a training session, which is CrossFit with more
--    running -- so the race number was overpaying the common case. Levelled
--    with CrossFit rather than kept slightly above it.
--    HIIT 1.2 -> 1.3: same class format, same modality mix and the same
--    logged-time honesty problem as CrossFit. No reason to sit below it.
--    NordicSki 1.3 -> 1.25: continuous full-body work, but it also earns
--    elevation credit (+0.05/m) that the gym-floor sports don't, so 1.3 was
--    paying it twice.
update scoring_config set multiplier = 1.3  where activity_type = 'Hyrox';
update scoring_config set multiplier = 1.3  where activity_type = 'HIIT';
update scoring_config set multiplier = 1.25 where activity_type = 'NordicSki';
