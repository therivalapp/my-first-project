-- Re-level the bottom of the multiplier range.
--
-- The scale was anchored on METs (cardiovascular cost per minute), which
-- systematically underrates strength, skill and intermittent sports. These
-- moves correct that bias without lifting the floor so far that the
-- multiplier stops distinguishing anything.

-- Structural load and genuine difficulty that METs don't see.
update scoring_config set multiplier = 1.0  where activity_type = 'WeightTraining';

-- Strava's catch-all. Lifted, but deliberately NOT to 1.0: it must stay above
-- DEFAULT_MULTIPLIER (0.8) without matching a named sport, or picking no type
-- would pay better than picking an unrecognised one.
update scoring_config set multiplier = 0.9  where activity_type = 'Workout';

-- Pilates above Yoga: pilates is continuous resisted work, where a yoga
-- session averages in long isometric holds and restorative passages.
update scoring_config set multiplier = 0.8  where activity_type = 'Pilates';
update scoring_config set multiplier = 0.65 where activity_type = 'Yoga';

-- Paddling is real upper-body work; the sit-and-wait time is already priced
-- in below the 1.0 baseline.
update scoring_config set multiplier = 0.8  where activity_type = 'Surfing';

-- The motor does some of the work, but the rider still pedals -- and often
-- for far longer than they otherwise would.
update scoring_config set multiplier = 0.7  where activity_type = 'EBikeRide';
