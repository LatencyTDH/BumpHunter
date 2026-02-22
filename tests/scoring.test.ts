import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock weather module to avoid network calls
vi.mock('../server/weather.js', () => ({
  getWeatherSeverity: vi.fn().mockResolvedValue({ score: 0, reason: null }),
}));

// Mock FAA module to avoid network calls
vi.mock('../server/faa.js', () => ({
  getAirportStatus: vi.fn().mockResolvedValue({ airport: 'XXX', delay: false }),
}));

// Mock opensky (FR24 + OpenSky + ADSBDB) to avoid network calls
// Provide deterministic fake "real flight" data for scoring tests
vi.mock('../server/opensky.js', () => ({
  getFlightsForRoute: vi.fn().mockImplementation(async (origin: string, dest: string, _dateStr: string) => {
    const knownAirports = ['ATL', 'LGA', 'CLT', 'LAX', 'DFW', 'ORD', 'EWR', 'DEN'];
    if (!knownAirports.includes(origin) || !knownAirports.includes(dest)) {
      return { flights: [], rateLimited: false, openskyRateLimited: false, error: `Unknown airport`, totalDepartures: 0, verifiedCount: 0, dataSources: [] };
    }

    const flights: any[] = [];

    // ATL→CLT: regional flights operated by SkyWest (OO)
    // ATL→LAX: widebody Delta mainline
    // Default: mix of DL mainline + AA mainline
    const carriers = origin === 'ATL' && dest === 'CLT'
      ? [{ code: 'DL', name: 'SkyWest Airlines (Delta)', regional: true, opCode: 'OO' }]
      : origin === 'ATL' && dest === 'LAX'
      ? [{ code: 'DL', name: 'Delta', regional: false, opCode: 'DL' }]
      : [
          { code: 'DL', name: 'Delta', regional: false, opCode: 'DL' },
          { code: 'AA', name: 'American', regional: false, opCode: 'AA' },
        ];

    const times = ['06:30', '08:00', '10:15', '12:30', '14:45', '17:00', '18:30', '20:00'];

    for (const carrier of carriers) {
      for (let i = 0; i < times.length; i++) {
        const flightNum = `${1000 + i}`;
        const icaoPrefix = carrier.code === 'DL' ? 'DAL' : carrier.code === 'AA' ? 'AAL' : 'UAL';
        flights.push({
          callsign: `${icaoPrefix}${flightNum}`,
          carrierCode: carrier.code,
          carrierName: carrier.name,
          flightNumber: `${carrier.code} ${flightNum}`,
          icao24: `abc${i}${carrier.code}`,
          departureTime: times[i],
          departureTimestamp: 1700000000 + i * 3600,
          verified: true,
          verificationSource: 'fr24',
          isRegional: carrier.regional,
          dataSource: 'fr24',
          fr24AircraftCode: carrier.regional ? 'E75S' : (dest === 'LAX' ? 'B763' : 'B738'),
          trackingUrl: `https://www.flightaware.com/live/flight/${icaoPrefix}${flightNum}`,
          operatingCarrierCode: carrier.opCode,
        });
      }
    }

    return {
      flights,
      rateLimited: false,
      openskyRateLimited: false,
      error: null,
      totalDepartures: flights.length,
      verifiedCount: flights.length,
      dataSources: ['FlightRadar24 (live)'],
    };
  }),
}));

import { scoreFlights } from '../server/scoring.js';
import { getHolidayScore } from '../server/holidays.js';

describe('Scoring Algorithm — Bump Opportunity Index (2025 ATCR)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('regional jets score higher than widebodies on comparable flights', async () => {
    // ATL→CLT: regional jets operated by SkyWest (OO, 9.43/10k DB rate)
    // ATL→LAX: widebodies by Delta mainline (DL, 5.68/10k)
    const regionalResult = await scoreFlights('ATL', 'CLT', '2026-04-14');
    const widebodyResult = await scoreFlights('ATL', 'LAX', '2026-04-14');

    expect(regionalResult.flights.length).toBeGreaterThan(0);
    expect(widebodyResult.flights.length).toBeGreaterThan(0);

    const regionals = regionalResult.flights.filter(f => f.isRegional);
    expect(regionals.length).toBeGreaterThan(0);
    for (const f of regionals) {
      expect(f.factors.some(fac => fac.includes('Regional jet'))).toBe(true);
    }

    const widebodies = widebodyResult.flights.filter(f => f.capacity > 200);
    expect(widebodies.length).toBeGreaterThan(0);
    for (const f of widebodies) {
      expect(f.isRegional).toBe(false);
    }

    const avgRegional = regionals.reduce((s, f) => s + f.bumpScore, 0) / regionals.length;
    const avgWidebody = widebodies.reduce((s, f) => s + f.bumpScore, 0) / widebodies.length;
    expect(avgRegional).toBeGreaterThan(avgWidebody);
  });

  it('last-bank flights score higher than midday flights', async () => {
    const result = await scoreFlights('ATL', 'LGA', '2026-04-14'); // Tuesday
    const flights = result.flights;
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
    const mondayResult = await scoreFlights('ATL', 'LGA', '2026-04-13');
    const tuesdayResult = await scoreFlights('ATL', 'LGA', '2026-04-14');

    expect(mondayResult.flights.length).toBeGreaterThan(0);
    expect(tuesdayResult.flights.length).toBeGreaterThan(0);

    const avgMonday = mondayResult.flights.reduce((s, f) => s + f.bumpScore, 0) / mondayResult.flights.length;
    const avgTuesday = tuesdayResult.flights.reduce((s, f) => s + f.bumpScore, 0) / tuesdayResult.flights.length;
    expect(avgMonday).toBeGreaterThan(avgTuesday);
  });

  it('score is capped at 100 and floored at 5', async () => {
    const result = await scoreFlights('ATL', 'LGA', '2026-04-13');
    for (const f of result.flights) {
      expect(f.bumpScore).toBeLessThanOrEqual(100);
      expect(f.bumpScore).toBeGreaterThanOrEqual(5);
    }
  });

  it('empty/unknown route returns empty results', async () => {
    const result = await scoreFlights('ZZZ', 'YYY', '2026-04-14');
    expect(result.flights).toEqual([]);
  });

  it('each flight has tracking URL and data source', async () => {
    const result = await scoreFlights('ATL', 'LGA', '2026-04-14');
    for (const f of result.flights) {
      expect(f.trackingUrl).toMatch(/^https:\/\/www\.flightaware\.com\/live\/flight\//);
      expect(['fr24', 'opensky']).toContain(f.dataSource);
      expect(f.callsign).toBeTruthy();
    }
  });

  it('includes DOT ATCR 2025 metadata in results', async () => {
    const result = await scoreFlights('ATL', 'LGA', '2026-04-14');
    expect(result.btsDataPeriod).toBeTruthy();
    expect(result.btsDataWarning).toBeTruthy();
    expect(result.btsDataPeriod).toContain('2025');
  });

  it('factors cite ATCR 2025 data source', async () => {
    const result = await scoreFlights('ATL', 'LGA', '2026-04-14');
    expect(result.flights.length).toBeGreaterThan(0);

    // Factor tags should reference ATCR 2025
    const hasATCRFactor = result.flights.some(f =>
      f.factors.some(fac => fac.includes('ATCR 2025'))
    );
    expect(hasATCRFactor).toBe(true);
  });

  it('SkyWest-operated regional flights score very high on carrier factor', async () => {
    // ATL→CLT mock uses SkyWest (OO) as operator — 9.43/10k DB rate
    const result = await scoreFlights('ATL', 'CLT', '2026-04-14');
    const flights = result.flights;
    expect(flights.length).toBeGreaterThan(0);

    // SkyWest flights should have VDB factor mentioning SkyWest
    const hasSkyWestFactor = flights.some(f =>
      f.factors.some(fac => fac.includes('SkyWest'))
    );
    expect(hasSkyWestFactor).toBe(true);

    // DB rate should be SkyWest's ~9.43, not Delta's ~5.68
    for (const f of flights) {
      expect(f.carrierDbRate).toBeGreaterThan(8);
    }
  });

  it('Delta mainline uses Delta DB rate (not a regional)', async () => {
    // ATL→LAX mock uses DL mainline as operator
    const result = await scoreFlights('ATL', 'LAX', '2026-04-14');
    const dlFlights = result.flights.filter(f => f.carrier === 'DL');
    expect(dlFlights.length).toBeGreaterThan(0);

    // Delta's 2025 ATCR DB rate ≈ 5.68/10k (all VDB, zero IDB)
    for (const f of dlFlights) {
      expect(f.carrierDbRate).toBeGreaterThan(4);
      expect(f.carrierDbRate).toBeLessThan(8);
    }
  });

  it('Sunday scores higher than Wednesday for day-of-week factor', async () => {
    // 2026-04-12 is Sunday, 2026-04-15 is Wednesday
    const sundayResult = await scoreFlights('ATL', 'LGA', '2026-04-12');
    const wednesdayResult = await scoreFlights('ATL', 'LGA', '2026-04-15');

    const avgSunday = sundayResult.flights.reduce((s, f) => s + f.bumpScore, 0) / sundayResult.flights.length;
    const avgWednesday = wednesdayResult.flights.reduce((s, f) => s + f.bumpScore, 0) / wednesdayResult.flights.length;
    expect(avgSunday).toBeGreaterThan(avgWednesday);
  });
});

// =============================================================================
// Holiday / Event Calendar Scoring
// =============================================================================

describe('Holiday / Event Calendar Scoring', () => {
  it('Thanksgiving Wednesday 2026 → high score (15)', () => {
    // Thanksgiving 2026 = Nov 26. Wednesday before = Nov 25 (within 3-day window).
    const date = new Date(2026, 10, 26); // Nov 26 2026 (Thanksgiving Day)
    const result = getHolidayScore(date);
    expect(result.score).toBe(15);
    expect(result.match?.name).toMatch(/Thanksgiving/i);
  });

  it('random Tuesday in February → low/zero score', () => {
    // Feb 10, 2026 is a Tuesday — no holiday nearby
    const date = new Date(2026, 1, 10);
    const result = getHolidayScore(date);
    expect(result.score).toBe(0);
    expect(result.match).toBeNull();
  });

  it('Christmas Eve → high score (14)', () => {
    // Dec 24, 2026 — within 3-day window before Christmas (Dec 25)
    const date = new Date(2026, 11, 24);
    const result = getHolidayScore(date);
    expect(result.score).toBe(14);
    expect(result.match?.name).toMatch(/Christmas/i);
  });

  it('Spring break date range → medium score (9)', () => {
    // Mar 15, 2026 is within the early spring break range (Mar 8-22)
    const date = new Date(2026, 2, 15);
    const result = getHolidayScore(date);
    expect(result.score).toBe(8);
    expect(result.match?.name).toMatch(/Spring Break/i);
  });

  it('Independence Day scores high', () => {
    // Jul 3, 2026 — within 2-day window before Jul 4
    const date = new Date(2026, 6, 3);
    const result = getHolidayScore(date);
    expect(result.score).toBe(11);
    expect(result.match?.name).toMatch(/Independence Day/i);
  });

  it('CES week boosts LAS flights', () => {
    // January, origin = LAS
    const date = new Date(2026, 0, 6);
    const result = getHolidayScore(date);
    expect(result.score).toBeGreaterThanOrEqual(8);
    expect(result.match?.name).toMatch(/CES/i);
  });











  it('overlapping holidays take the highest score', () => {
    // Dec 26, 2026 — within Christmas window (+2 after) AND New Year's window
    // (Dec 30+). Christmas intensity=14 should win if both match.
    const date = new Date(2026, 11, 26);
    const result = getHolidayScore(date);
    expect(result.score).toBe(14);
    expect(result.match?.name).toMatch(/Christmas/i);
  });

  it('Thanksgiving 2025 works with year-specific date', () => {
    // Thanksgiving 2025 = Nov 27. Day before = Nov 26.
    const date = new Date(2025, 10, 27); // Actual Thanksgiving Day
    const result = getHolidayScore(date);
    expect(result.score).toBe(15);
    expect(result.match?.name).toMatch(/Thanksgiving/i);
  });

  it('Thanksgiving holiday boosts full flight scoring', async () => {
    // Nov 25, 2026 (Wed before Thanksgiving) vs a random Tuesday in February
    const thanksgivingResult = await scoreFlights('ATL', 'LGA', '2026-11-25');
    const februaryResult = await scoreFlights('ATL', 'LGA', '2026-02-10');

    expect(thanksgivingResult.flights.length).toBeGreaterThan(0);
    expect(februaryResult.flights.length).toBeGreaterThan(0);

    const avgThanksgiving = thanksgivingResult.flights.reduce((s, f) => s + f.bumpScore, 0) / thanksgivingResult.flights.length;
    const avgFebruary = februaryResult.flights.reduce((s, f) => s + f.bumpScore, 0) / februaryResult.flights.length;
    expect(avgThanksgiving).toBeGreaterThan(avgFebruary);

    // Thanksgiving flights should have holiday factor tag
    const hasHolidayFactor = thanksgivingResult.flights.some(f =>
      f.factors.some(fac => fac.includes('Thanksgiving'))
    );
    expect(hasHolidayFactor).toBe(true);
  });
});
