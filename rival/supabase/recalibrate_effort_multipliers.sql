-- Effort recalibration, 2026-09-05.
--
-- Two changes, and the second is why the first was needed:
--
-- 1. The "+0.5 per km past 5km" distance bonus is GONE (removed in code, in
--    supabase/functions/_shared/effortScore.ts and src/lib/effort.ts). It was
--    sport-blind: 5km is unreachable for a swimmer, ~15 minutes for a cyclist,
--    and a rounding error for a runner. It paid for covering ground rather
--    than for working hard. Effort is now purely: minutes x multiplier.
--
-- 2. Because the multiplier is now the ONLY thing carrying intensity, every
--    value was re-derived rather than nudged. Anchored on MET values from the
--    Compendium of Physical Activities, then adjusted for three things METs
--    are blind to: structural load (lifting has low oxygen cost but real
--    adaptation), logged-duration honesty (a five-hour "ski day" is mostly
--    lift queues), and the brand rule that no one's session should read as
--    worthless (nothing below 0.6). The spread was deliberately compressed
--    from 3.0x to 2.5x so that showing up beats sport selection.
--
-- 3. Elevation is now credited: + metres climbed x a PER-SPORT rate (0.05 for
--    foot and pedal sports, i.e. 1 Effort per 20m), capped at half the
--    time-based score so a corrupt GPS trace can't distort a leaderboard.
--    Rated per sport because a flat rate would repeat the distance bonus's
--    mistake. Three deliberate zeroes:
--      - Swim: 16 of the swims in this database carry ~6m of "gain" that is
--        just open-water GPS bobbing.
--      - AlpineSki / Snowboard: Strava counts CHAIRLIFT ascent as gain, so a
--        lift-served day would out-earn a mountain run, for sitting down.
--      - VirtualRun / VirtualRide: treadmill and Zwift "climbing" isn't work
--        against gravity; the resistance is already paid for in time.
--
-- Headline correction: Swim was 1.5 — above Hyrox, and the highest in the app.
-- A hard swim and a hard run are both ~10 METs, and the old premium was really
-- compensating for swimmers never reaching the distance bonus. With the bonus
-- gone that reason disappears, so Swim sits at parity with Run.

-- Elevation is credited PER SPORT, so the rate lives here next to the
-- multiplier rather than as a constant in code. Default 0 means a new or
-- unknown activity type earns nothing for elevation until someone decides it
-- should — the safe direction, given the failure mode is paying out for
-- phantom gain (see the swim/chairlift notes below).
alter table scoring_config add column if not exists elevation_rate numeric not null default 0;

-- Rows that already exist are updated; the rest are new. Several of the new
-- ones are not exotic: `Row` is ALREADY in the activities table (written by
-- the AI photo scan) with no config row, so it has been silently scoring at
-- the 0.8 unknown-type default instead of 1.2. `Crossfit` is Strava's own
-- spelling (lowercase f) versus the `CrossFit` this app writes — the first
-- CrossFit that syncs from Strava would score 0.8 instead of 1.3.
insert into scoring_config (activity_type, multiplier, elevation_rate) values
  -- Race format / sustained near-maximal
  ('Hyrox',             1.5, 0),   -- 8x1km runs + 8 loaded stations, ~11-13 METs held for an hour
  ('CrossFit',          1.3, 0),   -- metcon is brutal, but a class includes skill work and rest
  ('Crossfit',          1.3, 0),   -- Strava's spelling of the same thing
  ('NordicSki',         1.3, 0.05),   -- one of the highest-MET sports there is; whole body

  -- Hard continuous cardio
  ('TrailRun',          1.25, 0.05),  -- elevation + terrain put it just above road pace-for-pace
  ('Run',               1.2, 0.05),   -- the anchor everything else is set against
  ('VirtualRun',        1.2, 0),   -- treadmill/Zwift: same physiological cost, no penalty
  ('Swim',              1.2, 0),   -- was 1.5; parity with Run (see headline note above)
  ('Rowing',            1.2, 0),   -- full body, continuous, no coasting
  ('Row',               1.2, 0),   -- variant the AI scan emits; same thing
  ('VirtualRow',        1.2, 0),
  ('HIIT',              1.2, 0),   -- high intensity is the definition

  -- Steady aerobic
  ('MountainBikeRide',  1.1, 0.05),   -- technical, little coasting
  ('GravelRide',        1.1, 0.05),
  ('Ride',              1.0, 0.05),   -- coasting, descents and stops pull the real average down
  ('VirtualRide',       1.0, 0),   -- trainer has NO coasting; if anything harder than outdoors
  ('Elliptical',        0.9, 0),
  ('Hike',              0.9, 0.05),   -- 6-8 METs with elevation; 0.7 badly underpaid a mountain day

  -- Strength / lower metabolic cost
  ('WeightTraining',    0.9, 0),   -- METs undervalue lifting: low oxygen cost, real adaptation
  ('AlpineSki',         0.8, 0),   -- not about intensity: logged ski days are mostly lifts
  ('Snowboard',         0.8, 0),
  ('Workout',           0.8, 0),   -- generic catch-all; matches DEFAULT_MULTIPLIER
  ('Kayaking',          0.8, 0),

  -- Low intensity / recovery — floored at 0.6 on purpose
  ('Yoga',              0.7, 0),   -- was 0.5, which read as dismissive; power yoga is 4-5 METs
  ('Pilates',           0.7, 0),
  ('StandUpPaddling',   0.7, 0),
  ('Surfing',           0.7, 0),
  ('Walk',              0.6, 0.05),   -- walking is how a lot of people start showing up
  ('EBikeRide',         0.6, 0.02)    -- assisted, but still out there
on conflict (activity_type) do update
  set multiplier     = excluded.multiplier,
      elevation_rate = excluded.elevation_rate;


-- Recompute every existing activity under the new formula, so the season
-- isn't scored under two different systems at once.
--
-- Safe to skip if you would rather leave history alone — nothing depends on
-- it being consistent except the leaderboards.
--
-- It also REPAIRS 16 broken rows found while checking this: Strava-imported
-- Walks from 2026-06-26 to 2026-08-02 have effort_score = NULL, so they have
-- been counting as zero in every total and leaderboard. Cause was an older
-- importer looking up a multiplier for a type that wasn't in scoring_config
-- yet, getting undefined, and storing minutes * undefined = NaN as NULL. The
-- current code can't reproduce it — all three importers now share
-- calculateEffortScore, which falls back to DEFAULT_MULTIPLIER — so this is
-- historical residue, not an ongoing leak.
--
-- It also levels out a second inconsistency found in the data: the client
-- entry paths multiplied by an `intensity` percentage that the server formula
-- had no concept of, and manual-entry hardcoded it to 50. A 60-minute run
-- typed in by hand scored 36 while the identical run synced from Strava
-- scored 72 — measured at 0.60 vs 1.22 Effort per minute. The intensity
-- factor has been removed from the code entirely (it only ever came from the
-- AI guessing from a photo, which shouldn't be able to halve a score), so
-- every entry path now agrees, and this backfill puts history on the same
-- footing.
update activities a
set effort_score     = c.score,
    raw_effort_score = c.score
from (
  select a2.id,
         round((
           a2.duration_seconds / 60.0 * coalesce(s.multiplier, 0.8)
           -- Climb allowance = max(2500 m/hour, a 1500m floor). Mirrors
           -- MAX_CLIMB_METRES_PER_HOUR / MIN_CLIMB_ALLOWANCE_METRES in code.
           -- Set above the Vertical Kilometre world record (~2075 m/hour) so
           -- it only ever catches altimeter drift and typos; the floor keeps
           -- a short, very steep effort from being clipped by the rate alone.
           + least(
               greatest(coalesce(a2.elevation_meters, 0), 0),
               greatest(a2.duration_seconds / 3600.0 * 2500, 1500)
             ) * coalesce(s.elevation_rate, 0)
         )::numeric, 1) as score
  from activities a2
  left join scoring_config s on s.activity_type = a2.activity_type
  where a2.duration_seconds is not null
) c
where c.id = a.id;
