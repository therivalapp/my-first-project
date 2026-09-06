import { describe, it, expect, vi } from 'vitest';

// effort.ts imports the supabase client (for loadScoringConfig), which
// requires env vars at module load — mock it, these tests only exercise the
// pure formula.
vi.mock('../supabase', () => ({ supabase: {} }));

import { calculateEffortScore } from '../effort';

// Mirrors the shape of the live scoring_config table: a multiplier for every
// sport, and an elevation rate only where climbing is real work done under
// your own power.
const CONFIG = {
  multipliers: { Run: 1.2, Ride: 1.0, Swim: 1.2, WeightTraining: 0.9, Hike: 0.9 },
  elevationRates: { Run: 0.05, Hike: 0.05, Ride: 0.05 },
};

describe('calculateEffortScore', () => {
  // These expectations mirror the server formula in
  // supabase/functions/_shared/effortScore.ts — if one changes, both must.
  it('scores minutes × multiplier', () => {
    expect(calculateEffortScore('Run', 30 * 60, 0, CONFIG)).toBe(36); // 30 × 1.2
    expect(calculateEffortScore('Ride', 60 * 60, 0, CONFIG)).toBe(60);
    expect(calculateEffortScore('WeightTraining', 45 * 60, 0, CONFIG)).toBe(40.5); // 45 × 0.9
  });

  it('uses the server default 0.8 for unknown types (NOT 1.0)', () => {
    // Regression: the old client copies defaulted to 1.0, so scanned workouts
    // of unlisted types scored 25% higher than Strava-imported ones.
    expect(calculateEffortScore('UnknownSport', 60 * 60, 0, CONFIG)).toBe(48); // 60 × 0.8
  });

  it('ignores distance entirely — the old +0.5/km past 5km bonus is gone', () => {
    // It was sport-blind: unreachable for a swimmer, trivial for a cyclist. It
    // paid for covering ground rather than for working hard, and you can coast
    // downhill. Two equally long runs must score the same however far they went.
    // (Third argument is elevation now, so distance simply has no input.)
    expect(calculateEffortScore('Run', 30 * 60, 0, CONFIG)).toBe(36);
  });

  it('credits elevation at the sport rate, on top of time', () => {
    // 60 min hike = 54, plus 400m climbed × 0.05 = 20.
    expect(calculateEffortScore('Hike', 60 * 60, 400, CONFIG)).toBe(74);
  });

  it('credits no elevation for sports where climbing is not real work', () => {
    // Swim has no rate: open-water GPS records phantom "gain" from bobbing,
    // and a pool obviously has none. Same guard covers AlpineSki (chairlifts)
    // and anything virtual.
    expect(calculateEffortScore('Swim', 60 * 60, 11, CONFIG)).toBe(72); // unchanged by the 11m
  });

  it('allows a genuinely big mountain day through uncapped', () => {
    // 121 min hike with 1179m of gain — a real activity from the database, at
    // 584 m/hour. An earlier cap (a fraction of the time score) clipped this;
    // it is a big day, not a broken GPS trace.
    // 121 × 0.9 = 108.9, plus 1179 × 0.05 = 58.95 → 167.9 (rounded).
    expect(calculateEffortScore('Hike', 121 * 60, 1179, CONFIG)).toBe(167.9);
  });

  it('credits a Vertical Kilometre effort in full', () => {
    // 1000m climbed in 29 minutes — roughly the VK world record, ~2075 m/hour.
    // An earlier 1500 m/hour cap clipped this, which was simply wrong: real
    // athletes go faster than that uphill.
    // 29 × 1.2 = 34.8, plus 1000 × 0.05 = 50 → 84.8
    expect(calculateEffortScore('Run', 29 * 60, 1000, CONFIG)).toBe(84.8);
  });

  it('ignores climb beyond anything a human could produce', () => {
    // 8000m in half an hour is altimeter drift or a typo, not an athlete.
    // Allowance = max(0.5h × 2500, 1500 floor) = 1500m.
    // 36 + (1500 × 0.05) = 111
    expect(calculateEffortScore('Run', 30 * 60, 8000, CONFIG)).toBe(111);
  });

  it('never scores on elevation alone when there is no duration', () => {
    // No hours means no climb allowance, so zero minutes earns zero.
    expect(calculateEffortScore('Run', 0, 800, CONFIG)).toBe(0);
  });

  it('ignores negative or missing elevation', () => {
    expect(calculateEffortScore('Run', 30 * 60, -200, CONFIG)).toBe(36);
    expect(calculateEffortScore('Run', 30 * 60, undefined as unknown as number, CONFIG)).toBe(36);
  });

  it('rounds to one decimal place', () => {
    expect(calculateEffortScore('Run', 17 * 60, 0, CONFIG)).toBe(20.4);
  });
});
