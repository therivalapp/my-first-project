import { supabase } from './supabase';

// The scoring_config table is the single source of truth for multipliers and
// elevation rates — the Strava edge functions read it on every import. Client
// entry paths (scan-workout, weekly-scan, manual-entry) MUST score from the
// same table, or the same workout earns different Effort depending on how it
// entered the app.
//
// This snapshot is only the offline/failed-fetch fallback (matches the live
// table as of 2026-09-05); the fetched values always win.
const FALLBACK_MULTIPLIERS: Record<string, number> = {
  AlpineSki: 0.8, CrossFit: 1.3, EBikeRide: 0.7, Elliptical: 0.9,
  Bootcamp: 1.25, GravelRide: 1.1, HIIT: 1.3, Hike: 0.9, Hyrox: 1.3, Kayaking: 0.8,
  MountainBikeRide: 1.1, NordicSki: 1.25, Pilates: 0.8, Ride: 1.0,
  Rowing: 1.2, Run: 1.2, Snowboard: 0.8, StandUpPaddling: 0.7, Surfing: 0.8,
  Swim: 1.2, TrailRun: 1.25, VirtualRide: 1.0, VirtualRow: 1.2, VirtualRun: 1.2,
  Walk: 0.6, WeightTraining: 1.0, Workout: 0.9, Yoga: 0.65,
};

// Effort per metre climbed. Anything absent is 0 — elevation is only credited
// where it represents work done against gravity under your own power. See the
// note in supabase/functions/_shared/effortScore.ts for why swimming, downhill
// skiing and anything virtual are deliberately excluded.
const FALLBACK_ELEVATION_RATES: Record<string, number> = {
  Run: 0.05, TrailRun: 0.05, Hike: 0.05, Walk: 0.05,
  Ride: 0.05, MountainBikeRide: 0.05, GravelRide: 0.05,
  NordicSki: 0.05,
  EBikeRide: 0.02, // assisted, but the rider still contributes on a climb
};

// Same unknown-type default the edge functions use.
export const DEFAULT_MULTIPLIER = 0.8;

// Keep in lockstep with the edge functions. See the note there: the rate sits
// above the Vertical Kilometre world record (~2075 m/hour), and the floor
// stops a short steep effort being clipped by the rate alone.
const MAX_CLIMB_METRES_PER_HOUR = 2500;
const MIN_CLIMB_ALLOWANCE_METRES = 1500;

export type ScoringConfig = {
  multipliers: Record<string, number>;
  elevationRates: Record<string, number>;
};

let cached: ScoringConfig | null = null;

export async function loadScoringConfig(): Promise<ScoringConfig> {
  if (cached) return cached;
  // select('*'), not a named column list — PostgREST fails the whole query on
  // an unknown column, so naming elevation_rate would drop the app to
  // FALLBACK_MULTIPLIERS everywhere until the migration is run.
  const { data } = await supabase.from('scoring_config').select('*');
  if (!data || data.length === 0) {
    return { multipliers: FALLBACK_MULTIPLIERS, elevationRates: FALLBACK_ELEVATION_RATES };
  }
  const multipliers: Record<string, number> = {};
  const elevationRates: Record<string, number> = {};
  for (const row of data) {
    multipliers[row.activity_type] = Number(row.multiplier);
    elevationRates[row.activity_type] = Number(row.elevation_rate ?? 0);
  }
  cached = { multipliers, elevationRates };
  return cached;
}

// Must stay in lockstep with calculateEffortScore in the Strava edge functions
// (strava-webhook / strava-full-import / strava-backfill):
//   Effort = minutes x multiplier + metres climbed x elevation rate, capped.
//
// There used to be an extra `intensity` percentage here, applied only on the
// client paths. It broke the one invariant this file exists to protect: a
// 60-minute run typed in by hand scored 36 while the SAME run synced from
// Strava scored 72, because manual-entry hardcoded intensity=50 and the
// server formula has no intensity concept at all. Verified in the data —
// hand-entered runs sat at 0.60 Effort/minute against Strava's 1.22.
//
// Removed rather than defaulted to 100, because the only real source of an
// intensity value was a guess the AI made from a photo, and no photo-derived
// guess should be able to halve or double what an activity is worth.
export function calculateEffortScore(
  activityType: string,
  durationSeconds: number,
  elevationMeters: number,
  config: ScoringConfig,
): number {
  const multiplier = config.multipliers[activityType] ?? DEFAULT_MULTIPLIER;
  const minutes = durationSeconds / 60;
  const timeScore = minutes * multiplier;

  const rate = config.elevationRates[activityType] ?? 0;
  const hours = durationSeconds / 3600;
  const allowance = hours > 0
    ? Math.max(hours * MAX_CLIMB_METRES_PER_HOUR, MIN_CLIMB_ALLOWANCE_METRES)
    : 0;
  const climb = Math.min(Math.max(0, elevationMeters || 0), allowance);
  const elevationScore = climb * rate;

  return Math.round((timeScore + elevationScore) * 10) / 10;
}
