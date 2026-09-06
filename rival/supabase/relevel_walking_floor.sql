-- Re-level walking and the floor beneath it.
--
-- The trigger was Strava auto-syncing walks. The answer is NOT a cap: a walk
-- to work is real effort, and capping it would tell someone their effort stops
-- counting — which is the one thing this app doesn't do. The rate is the
-- honest lever, not a ceiling.
--
-- The evidence for moving it: two hours of walking and forty-five minutes of
-- running are roughly the same metabolic work (~7 MET-hours each). Today that
-- walk scores 72 and the run 54, because 0.6/1.2 rates walking at HALF a run
-- when the metabolic ratio is nearer 0.36. At 0.5 it's 60 vs 54 — close to
-- parity, and a walking commute still pays well.
--
-- Nothing here reduces what walking can accumulate. There is no cap, and Walk
-- keeps the full +0.05/m elevation rate, so an hour up a hill still earns
-- meaningfully more than an hour on the flat.

-- Walking: still generous against its metabolic cost, no longer out-earning
-- an equivalent run.
update scoring_config set multiplier = 0.5 where activity_type = 'Walk';

-- Golf IS walking — four hours and roughly 8km, often carrying clubs. It was
-- lifted to 0.6 specifically to match Walk, so it follows Walk down rather
-- than drifting above it.
update scoring_config set multiplier = 0.5 where activity_type = 'Golf';

-- Sail has to stay below walking, and at 0.5 it would have tied it. Leisure
-- sailing is ~3 METs against walking's 3.5-4.3, and much of it is sitting and
-- steering. This becomes the new floor of the whole table.
update scoring_config set multiplier = 0.4 where activity_type = 'Sail';
