-- Audit pass over scoring_config. Three consistency fixes.

-- 1. Team sports: 1.1 -> 1.0.
--    We discounted CrossFit/Hyrox/HIIT to 1.3 on the principle that LOGGED
--    duration includes non-working time (warm-up, skill work, coaching).
--    Team sports break that principle harder than anything else in the table:
--    a rugby match is 80 minutes of clock with roughly 35 of ball-in-play,
--    and a 48-minute basketball game takes well over two hours. At 1.1 they
--    were sitting ABOVE Ride and level with MountainBikeRide -- both of which
--    are continuous work for every logged minute.
update scoring_config set multiplier = 1.0
where activity_type in ('Soccer','Football','Rugby','Basketball','FieldHockey',
                        'IceHockey','Handball','Lacrosse');

-- 2. Squash 1.2 -> 1.1.
--    Squash genuinely is the hardest racquet sport, but 1.2 put it level with
--    Run and Swim, which are continuous for every logged minute. A court
--    booking includes knocking up and between-game rest. Still the top
--    racquet sport, just not a running/swimming equivalent.
update scoring_config set multiplier = 1.1 where activity_type = 'Squash';

-- 3. Frisbee 0.9 -> 1.0.
--    Strava's "Frisbee" is in practice ultimate, which is continuous
--    sprinting and cutting -- much closer to a field sport than to the
--    low-intensity bucket 0.9 put it in.
update scoring_config set multiplier = 1.0 where activity_type = 'Frisbee';

-- 4. Golf 0.5 -> 0.6, matching Walk.
--    Walking 18 holes is roughly 8km over four hours. At 0.5 a golfer scored
--    LESS than if they had logged the identical walking as a Walk (0.6) --
--    a mislabel incentive, and the wrong way round.
update scoring_config set multiplier = 0.6 where activity_type = 'Golf';
