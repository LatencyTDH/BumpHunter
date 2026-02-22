import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock weather module to avoid network calls
vi.mock('../server/weather.js', () => ({
  getWeatherSeverity: vi.fn().mockResolvedValue({ score: 0, reason: null }),
}));

// Mock opensky (FR24 + OpenSky + ADSBDB) to avoid network calls
// Provide deterministic fake "real flight" data for scoring tests
vi.mock('../server/opensky.js', () => ({
  getFlightsForRoute: vi.fn().mockImplementation(async (origin: string, dest: string, _dateStr: string) => {
    // Return empty for unknown airports
    const knownAirports = ['ATL', 'LGA', 'CLT', 'LAX', 'DFW', 'ORD', 'EWR', 'DEN'];
    if (!knownAirports.includes(origin) || !knownAirports.includes(dest)) {
      return { flights: [], rateLimited: false, openskyRateLimited: false, error: `Unknown airport`, totalDepartures: 0, verifiedCount: 0, dataSources: [] };
    }

    // Generate deterministic test flights based on route
    const flights: any[] = [];
    const carriers = origin === 'ATL' && dest === 'CLT'
      ? [{ code: 'DL', name: 'Delta', regional: true }]
      : origin === 'ATL' && dest === 'LAX'
      ? [{ code: 'DL', name: 'Delta', regional: false }]
      : [
          { code: 'DL', name: 'Delta', regional: false },
          { code: 'AA', name: 'American', regional: false },
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

describe('Scoring Algorithm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('regional jets score higher than widebodies on comparable flights', async () => {
    // ATL→CLT uses regional jets (CRJ900/E175, 76 seats)
    // ATL→LAX uses widebodies (B767, 211 seats)
    // Use a Tuesday to minimize day-of-week noise
    const regionalResult = await scoreFlights('ATL', 'CLT', '2026-04-14');
    const widebodyResult = await scoreFlights('ATL', 'LAX', '2026-04-14');

    expect(regionalResult.flights.length).toBeGreaterThan(0);
    expect(widebodyResult.flights.length).toBeGreaterThan(0);

    // All CLT regional flights should be flagged
    const regionals = regionalResult.flights.filter(f => f.isRegional);
    expect(regionals.length).toBeGreaterThan(0);
    for (const f of regionals) {
      expect(f.factors.some(fac => fac.includes('Regional jet'))).toBe(true);
    }

    // Widebody flights should NOT be regional
    const widebodies = widebodyResult.flights.filter(f => f.capacity > 200);
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

  it('score is capped at 98', async () => {
    const result = await scoreFlights('ATL', 'LGA', '2026-04-13'); // Monday (peak)
    for (const f of result.flights) {
      expect(f.bumpScore).toBeLessThanOrEqual(98);
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
});
