import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock weather module to avoid network calls
vi.mock('../server/weather.js', () => ({
  getWeatherSeverity: vi.fn().mockResolvedValue({ score: 0, reason: null }),
}));

import { scoreFlights } from '../server/scoring.js';

describe('Scoring Algorithm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('regional jets score higher than widebodies on comparable flights', async () => {
    // ATL→CLT uses regional jets (CRJ900/E175, 76 seats)
    // ATL→LAX uses widebodies (B767, 211 seats)
    // Use a Tuesday to minimize day-of-week noise
    const regionalFlights = await scoreFlights('ATL', 'CLT', '2026-04-14');
    const widebodyFlights = await scoreFlights('ATL', 'LAX', '2026-04-14');

    expect(regionalFlights.length).toBeGreaterThan(0);
    expect(widebodyFlights.length).toBeGreaterThan(0);

    // All CLT regional flights should be flagged
    const regionals = regionalFlights.filter(f => f.isRegional);
    expect(regionals.length).toBeGreaterThan(0);
    for (const f of regionals) {
      expect(f.factors.some(fac => fac.includes('Regional jet'))).toBe(true);
    }

    // Widebody flights should NOT be regional
    const widebodies = widebodyFlights.filter(f => f.capacity > 200);
    expect(widebodies.length).toBeGreaterThan(0);
    for (const f of widebodies) {
      expect(f.isRegional).toBe(false);
    }

    // Average regional score should exceed average widebody score
    const avgRegional = regionals.reduce((s, f) => s + f.bumpScore, 0) / regionals.length;
    const avgWidebody = widebodies.reduce((s, f) => s + f.bumpScore, 0) / widebodies.length;
    expect(avgRegional).toBeGreaterThan(avgWidebody);
  });

  it('last-bank flights score higher than midday flights', async () => {
    // ATL→LGA has departures from 06:00 to 20:45 on Delta
    const flights = await scoreFlights('ATL', 'LGA', '2026-04-14'); // Tuesday
    expect(flights.length).toBeGreaterThan(0);

    const lastBank = flights.filter(f => {
      const [h] = f.depTime.split(':').map(Number);
      return h >= 18;
    });
    const midday = flights.filter(f => {
      const [h] = f.depTime.split(':').map(Number);
      return h >= 11 && h <= 14;
    });

    expect(lastBank.length).toBeGreaterThan(0);
    expect(midday.length).toBeGreaterThan(0);

    const avgLastBank = lastBank.reduce((s, f) => s + f.bumpScore, 0) / lastBank.length;
    const avgMidday = midday.reduce((s, f) => s + f.bumpScore, 0) / midday.length;
    expect(avgLastBank).toBeGreaterThan(avgMidday);
  });

  it('peak business days (Monday) score higher than Tuesdays', async () => {
    // 2026-04-13 is Monday, 2026-04-14 is Tuesday
    const mondayFlights = await scoreFlights('ATL', 'LGA', '2026-04-13');
    const tuesdayFlights = await scoreFlights('ATL', 'LGA', '2026-04-14');

    expect(mondayFlights.length).toBeGreaterThan(0);
    expect(tuesdayFlights.length).toBeGreaterThan(0);

    const avgMonday = mondayFlights.reduce((s, f) => s + f.bumpScore, 0) / mondayFlights.length;
    const avgTuesday = tuesdayFlights.reduce((s, f) => s + f.bumpScore, 0) / tuesdayFlights.length;
    expect(avgMonday).toBeGreaterThan(avgTuesday);
  });

  it('score is capped at 98', async () => {
    const flights = await scoreFlights('ATL', 'LGA', '2026-04-13'); // Monday (peak)
    for (const f of flights) {
      expect(f.bumpScore).toBeLessThanOrEqual(98);
      expect(f.bumpScore).toBeGreaterThanOrEqual(5);
    }
  });

  it('empty/unknown route returns empty results', async () => {
    const flights = await scoreFlights('ZZZ', 'YYY', '2026-04-14');
    expect(flights).toEqual([]);
  });
});
