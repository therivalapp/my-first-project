-- Sports Strava can send that had no scoring_config row, so they were all
-- silently scoring at DEFAULT_MULTIPLIER (0.8) regardless of what they are.
--
-- 0.8 is a sane fallback, not a correct answer: it overpays Golf and
-- EMountainBikeRide, and underpays BackcountrySki and RollerSki.
--
-- Elevation rates follow the existing rule: credit only where the athlete
-- lifts their own bodyweight and the altimeter is trustworthy. Ski touring
-- and snowshoeing qualify. RockClimbing does NOT -- Strava's barometric gain
-- on a climb is noise, and the real vertical is metres, not hundreds.

insert into scoring_config (activity_type, multiplier, elevation_rate) values
  -- Human-powered snow: uphill under your own steam.
  ('BackcountrySki',     1.25, 0.05),
  ('Snowshoe',           1.0,  0.05),
  ('RollerSki',          1.2,  0.05),

  -- Motor-assisted. Must match EBikeRide (0.7) -- at the 0.8 default an
  -- e-MTB was out-earning a plain e-bike for the same assisted effort.
  ('EMountainBikeRide',  0.7,  0.02),

  -- Arm-powered, NOT assisted. Propelling yourself on arms alone is
  -- metabolically harder per minute than riding, not easier -- these sit
  -- above Ride, and a climb costs the athlete far more than it costs a
  -- cyclist, so they earn the full elevation rate.
  ('Handcycle',          1.1,  0.05),
  ('Wheelchair',         1.1,  0.05),
  -- A velomobile is human-powered but faired and recumbent: very efficient,
  -- so slightly under an upright ride.
  ('Velomobile',         0.9,  0.05),

  -- Gym / indoor.
  ('StairStepper',       1.0,  0),
  ('RockClimbing',       1.1,  0),
  ('MartialArts',        1.1,  0),
  ('TrackAndField',      1.1,  0),

  -- Field sports: continuous running with natural stoppages.
  ('Soccer',             1.1,  0),
  ('Football',           1.1,  0),
  ('Rugby',              1.1,  0),
  ('Basketball',         1.1,  0),
  ('FieldHockey',        1.1,  0),
  ('IceHockey',          1.1,  0),
  ('Handball',           1.1,  0),
  ('Lacrosse',           1.1,  0),
  ('Volleyball',         0.9,  0),
  ('Cricket',            0.7,  0),

  -- Racquet sports. Squash is the outlier -- near-continuous, tiny court.
  ('Squash',             1.2,  0),
  ('Racquetball',        1.1,  0),
  ('Tennis',             1.0,  0),
  ('Badminton',          1.0,  0),
  ('Pickleball',         0.8,  0),
  ('TableTennis',        0.7,  0),

  -- Water.
  ('Canoeing',           0.8,  0),
  ('Windsurf',           0.8,  0),
  ('Kitesurf',           0.8,  0),
  ('Sail',               0.5,  0),

  -- Skating and wheels.
  ('IceSkate',           0.9,  0),
  ('InlineSkate',        0.9,  0),
  ('Skateboard',         0.7,  0),

  -- Low-intensity but still showing up.
  ('Golf',               0.5,  0),
  ('Fencing',            1.0,  0),
  ('Frisbee',            0.9,  0)
on conflict (activity_type) do update
  set multiplier = excluded.multiplier,
      elevation_rate = excluded.elevation_rate;
