import { describe, it, expect, vi } from 'vitest';
import { scoreOriginDepartures } from '../server/scoring.js';

vi.mock('../server/fr24.js', () => ({
  getFR24ScheduleDepartures: vi.fn(),
  getFR24ScheduleForRoute: vi.fn(),
  FR24_AIRCRAFT_MAP: { A321: 'A321' },
}));

vi.mock('../server/weather.js', () => ({
  getWeatherSeverity: vi.fn().mockResolvedValue({ score: 0, reason: null }),
}));

vi.mock('../server/faa.js', () => ({
  getAirportStatus: vi.fn().mockResolvedValue({ airport: 'ATL', delay: false }),
}));

import { getFR24ScheduleDepartures } from '../server/fr24.js';

const mockedSchedule = vi.mocked(getFR24ScheduleDepartures);

function buildScheduleFlight(idx: number, destination: string) {
  const flightNum = 100 + idx;
  return {
    flightNumber: `DL${flightNum}`,
    callsign: `DAL${flightNum}`,
    codeshares: [],
    destination,
    destinationName: `${destination} Airport`,
    aircraftCode: 'A321',
    aircraftName: 'Airbus A321-211',
    registration: 'N123DL',
    airline: 'Delta Air Lines',
    airlineIata: 'DL',
    airlineIcao: 'DAL',
    status: 'Scheduled',
    isLive: false,
    departureTimestamp: 1700000000 + idx * 3600,
    depTime: `${String(6 + (idx % 12)).padStart(2, '0')}:00`,
  };
}

describe('Flexible origin-only search', () => {
  it('returns top 20 scored departures from an origin', async () => {
    const flights = Array.from({ length: 25 }, (_, idx) =>
      buildScheduleFlight(idx, idx % 2 === 0 ? 'LGA' : 'JFK'),
    );

    mockedSchedule.mockResolvedValue({
      flights,
      totalFlights: flights.length,
      error: null,
    });

    const result = await scoreOriginDepartures('ATL', '2026-04-14');
    expect(result.flights.length).toBe(20);
    expect(result.totalDepartures).toBe(25);
    expect(result.flights.every(f => f.departure === 'ATL')).toBe(true);

    for (let i = 1; i < result.flights.length; i++) {
      expect(result.flights[i - 1].bumpScore).toBeGreaterThanOrEqual(result.flights[i].bumpScore);
    }
  });
});
