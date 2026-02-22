import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock weather module
vi.mock('../server/weather.js', () => ({
  getWeatherSeverity: vi.fn().mockResolvedValue({ score: 0, reason: null }),
}));

// Mock FAA module — start with no delays, override per test
vi.mock('../server/faa.js', () => ({
  getAirportStatus: vi.fn().mockResolvedValue({ airport: 'XXX', delay: false }),
}));

// Mock BTS on-time performance to avoid network calls
vi.mock('../server/otp.js', () => ({
  getRouteReliability: vi.fn().mockResolvedValue({
    origin: 'ATL',
    dest: 'LGA',
    delayPct: 28.5,
    totalFlights: 500,
    periodLabel: 'Dec 2024–Nov 2025',
    source: 'BTS On-Time (transtats.bts.gov)',
    available: true,
  }),
}));

// Mock FR24 schedule
vi.mock('../server/fr24.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../server/fr24.js')>();
  return {
    ...actual,
    getFR24ScheduleForRoute: vi.fn().mockResolvedValue({ flights: [] }),
  };
});

// Mock opensky — provide deterministic flights
vi.mock('../server/opensky.js', () => ({
  getFlightsForRoute: vi.fn().mockImplementation(async (origin: string, dest: string) => {
    const knownAirports = ['ATL', 'LGA', 'CLT', 'LAX', 'DFW', 'ORD', 'EWR', 'DEN'];
    if (!knownAirports.includes(origin) || !knownAirports.includes(dest)) {
      return { flights: [], rateLimited: false, openskyRateLimited: false, error: 'Unknown', totalDepartures: 0, verifiedCount: 0, dataSources: [] };
    }

    const flights = [
      {
        callsign: `DL100`,
        carrierCode: 'DL',
        flightNumber: 'DL100',
        departureTime: '08:30',
        arrivalTime: '11:45',
        origin,
        destination: dest,
        aircraftType: 'B738',
        registration: 'N100DL',
        dataSource: 'fr24-live' as const,
        status: 'scheduled',
        codeshares: [],
      },
      {
        callsign: `UA200`,
        carrierCode: 'UA',
        flightNumber: 'UA200',
        departureTime: '14:00',
        arrivalTime: '17:15',
        origin,
        destination: dest,
        aircraftType: 'A320',
        registration: 'N200UA',
        dataSource: 'fr24-live' as const,
        status: 'scheduled',
        codeshares: [],
      },
    ];

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

// Mock cache
vi.mock('../server/cache.js', () => ({
  cacheGet: vi.fn().mockReturnValue(null),
  cacheSet: vi.fn(),
  cacheCleanup: vi.fn(),
}));

import { scoreFlights } from '../server/scoring.js';
import { getAirportStatus } from '../server/faa.js';

const mockedGetAirportStatus = vi.mocked(getAirportStatus);

describe('FAA Disruption Scoring Integration', () => {
  beforeEach(() => {
    // Reset to default (no delays)
    mockedGetAirportStatus.mockReset();
    mockedGetAirportStatus.mockResolvedValue({ airport: 'XXX', delay: false });
  });

  it('Ground Stop at origin produces FAA factor tag', async () => {
    mockedGetAirportStatus.mockImplementation(async (iata: string) => {
      if (iata === 'ORD') return { airport: 'ORD', delay: true, delayType: 'GS' as const, reason: 'thunderstorms' };
      return { airport: iata, delay: false };
    });

    const result = await scoreFlights('ORD', 'LGA', '2026-04-14');
    expect(result.flights.length).toBeGreaterThan(0);

    const hasFAAFactor = result.flights.some(f =>
      f.factors.some(fac => fac.includes('FAA Ground Stop at ORD'))
    );
    expect(hasFAAFactor).toBe(true);
  });

  it('GDP at destination produces FAA factor tag with avg delay', async () => {
    mockedGetAirportStatus.mockImplementation(async (iata: string) => {
      if (iata === 'LGA') return { airport: 'LGA', delay: true, delayType: 'GDP' as const, reason: 'wind', avgDelay: '45 minutes' };
      return { airport: iata, delay: false };
    });

    const result = await scoreFlights('ATL', 'LGA', '2026-04-14');
    expect(result.flights.length).toBeGreaterThan(0);

    const hasFAAFactor = result.flights.some(f =>
      f.factors.some(fac => fac.includes('FAA Ground Delay at LGA'))
    );
    expect(hasFAAFactor).toBe(true);

    const hasAvgDelay = result.flights.some(f =>
      f.factors.some(fac => fac.includes('45 minutes'))
    );
    expect(hasAvgDelay).toBe(true);
  });

  it('FAA API failure results in no FAA points and no crash', async () => {
    mockedGetAirportStatus.mockResolvedValue({ airport: 'XXX', delay: false });

    const result = await scoreFlights('ATL', 'LGA', '2026-04-14');
    expect(result.flights.length).toBeGreaterThan(0);
    for (const f of result.flights) {
      expect(f.bumpScore).toBeGreaterThanOrEqual(5);
      const hasFAAFactor = f.factors.some(fac => fac.includes('FAA'));
      expect(hasFAAFactor).toBe(false);
    }
  });
});
