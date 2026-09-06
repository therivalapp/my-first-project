// Canonical activity_type spellings.
//
// Providers disagree about capitalisation, and scoring_config is keyed on the
// exact string, so an un-normalised import silently creates a SECOND config
// row for the same sport (Strava sends "Crossfit"; RIVAL's own manual entry
// writes "CrossFit"). That splits one sport across two rows in the admin
// scoring table, and if only one of them is ever tuned, the same workout
// scores differently depending on where it came from.
//
// Normalise at ingest — one row per sport, always.

const ALIASES: Record<string, string> = {
  // Strava
  crossfit: 'CrossFit',
  weighttraining: 'WeightTraining',
  virtualrun: 'VirtualRun',
  virtualride: 'VirtualRide',
  ebikeride: 'EBikeRide',
  nordicski: 'NordicSki',
  alpineski: 'AlpineSki',
  backcountryski: 'BackcountrySki',
  trailrun: 'TrailRun',
  stairstepper: 'StairStepper',
  rockclimbing: 'RockClimbing',
  inlineskate: 'InlineSkate',
  iceskate: 'IceSkate',
  standuppaddling: 'StandUpPaddling',
  // Strava's rower type is "Rowing"; some scan output says "Row".
  row: 'Rowing',
  rowing: 'Rowing',
  hyrox: 'Hyrox',
  hiit: 'HIIT',
  // Strava's own name for HIIT. Without this every Strava HIIT session
  // would miss the HIIT config row entirely and fall to the default.
  highintensityintervaltraining: 'HIIT',
  // Case-only variants — cheap insurance against a provider changing its
  // capitalisation, which would otherwise silently fork the config row.
  emountainbikeride: 'EMountainBikeRide',
  gravelride: 'GravelRide',
  mountainbikeride: 'MountainBikeRide',
  virtualrow: 'VirtualRow',
  rollerski: 'RollerSki',
  trackandfield: 'TrackAndField',
  martialarts: 'MartialArts',
  fieldhockey: 'FieldHockey',
  icehockey: 'IceHockey',
  tabletennis: 'TableTennis',
  // Strava's enum appears to carry both spellings; an unused alias is free,
  // a missed one silently forks the config row.
  windsurfing: 'Windsurf',
  windsurf: 'Windsurf',
}

export function normaliseActivityType(raw: string | null | undefined): string {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return 'Workout'
  return ALIASES[trimmed.toLowerCase()] ?? trimmed
}
