-- Bootcamp: outdoor/group circuit class.
--
-- Sits just under the CrossFit/Hyrox/HIIT tier (1.3) rather than level with
-- it. Same class format and the same logged-time caveat -- an hour on the
-- clock includes briefing, transitions and demos -- but bootcamps are
-- typically bodyweight, bands and light weights, without the loaded barbell
-- work that earns the other three their extra 0.05.
--
-- No elevation credit: it's a field or a park, and any gain recorded is drift.
insert into scoring_config (activity_type, multiplier, elevation_rate)
values ('Bootcamp', 1.25, 0)
on conflict (activity_type) do update
  set multiplier = excluded.multiplier, elevation_rate = excluded.elevation_rate;
