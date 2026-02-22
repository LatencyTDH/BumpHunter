import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../server/weather.js', () => ({
  getWeatherSeverity: vi.fn(),
}));

vi.mock('../server/faa.js', () => ({
  getAirportStatus: vi.fn().mockResolvedValue({ airport: 'XXX', delay: false }),
}));

vi.mock('../server/fr24.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../server/fr24.js')>();
  return {
    ...actual,
    getFR24ScheduleForRoute: vi.fn().mockResolvedValue({ flights: [] }),
  };
});

vi.mock('../server/opensky.js', () => ({
  getFlightsForRoute: vi.fn(),
}));

import { scoreFlights } from '../server/scoring.js';
import { getWeatherSeverity } from '../server/weather.js';
import { getFlightsForRoute } from '../server/opensky.js';

const mockedWeather = vi.mocked(getWeatherSeverity);
const mockedFlights = vi.mocked(getFlightsForRoute);

describe('Cascade Boost scoring', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-14T10:00:00-04:00'));

    mockedWeather.mockImplementation(async (airport: string) => {
      if (airport === 'ATL') {
        return { score: 15, reason: 'Low Visibility at ATL' }; // moderate
      }
      return { score: 0, reason: null };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('boosts flights 2–8 hours after hub disruption', async () => {
    mockedFlights.mockResolvedValue({
      flights: [
        {
          callsign: 'DAL100',
          carrierCode: 'DL',
          carrierName: 'Delta',
          flightNumber: 'DL 100',
          icao24: 'abc123',
          departureTime: '14:00',
          departureTimestamp: 1700000000,
          verified: true,
          verificationSource: 'fr24-schedule',
          isRegional: false,
          dataSource: 'fr24-schedule',
          fr24AircraftCode: 'B738',
          trackingUrl: 'https://www.flightaware.com/live/flight/DAL100',
          operatingCarrierCode: 'DL',
          airline: 'Delta Air Lines',
          aircraftName: 'Boeing 737-800',
          registration: 'N001DL',
          status: 'Scheduled',
          isLive: false,
          codeshares: [],
        },
        {
          callsign: 'DAL200',
          carrierCode: 'DL',
          carrierName: 'Delta',
          flightNumber: 'DL 200',
          icao24: 'abc456',
          departureTime: '19:00',
          departureTimestamp: 1700003600,
          verified: true,
          verificationSource: 'fr24-schedule',
          isRegional: false,
          dataSource: 'fr24-schedule',
          fr24AircraftCode: 'B738',
          trackingUrl: 'https://www.flightaware.com/live/flight/DAL200',
          operatingCarrierCode: 'DL',
          airline: 'Delta Air Lines',
          aircraftName: 'Boeing 737-800',
          registration: 'N001DL',
          status: 'Scheduled',
          isLive: false,
          codeshares: [],
        },
      ],
      rateLimited: false,
      openskyRateLimited: false,
      error: null,
      totalDepartures: 2,
      verifiedCount: 2,
      dataSources: ['FlightRadar24 (live)'],
    });

    const result = await scoreFlights('ATL', 'LGA', '2026-04-14');
    const flight14 = result.flights.find(f => f.depTime === '14:00');
    const flight19 = result.flights.find(f => f.depTime === '19:00');

    expect(flight14).toBeTruthy();
    expect(flight19).toBeTruthy();

    const cascade14 = flight14?.factorsDetailed.find(f => f.name === 'Cascade Boost');
    const cascade19 = flight19?.factorsDetailed.find(f => f.name === 'Cascade Boost');

    expect(cascade14?.score).toBeGreaterThan(0);
    expect(cascade19?.score).toBe(0);
  });

  it('gives max boost for single-daily-frequency routes', async () => {
    mockedFlights.mockResolvedValue({
      flights: [
        {
          callsign: 'DAL300',
          carrierCode: 'DL',
          carrierName: 'Delta',
          flightNumber: 'DL 300',
          icao24: 'abc789',
          departureTime: '14:00',
          departureTimestamp: 1700000000,
          verified: true,
          verificationSource: 'fr24-schedule',
          isRegional: false,
          dataSource: 'fr24-schedule',
          fr24AircraftCode: 'B738',
          trackingUrl: 'https://www.flightaware.com/live/flight/DAL300',
          operatingCarrierCode: 'DL',
          airline: 'Delta Air Lines',
          aircraftName: 'Boeing 737-800',
          registration: 'N001DL',
          status: 'Scheduled',
          isLive: false,
          codeshares: [],
        },
      ],
      rateLimited: false,
      openskyRateLimited: false,
      error: null,
      totalDepartures: 1,
      verifiedCount: 1,
      dataSources: ['FlightRadar24 (live)'],
    });

    const result = await scoreFlights('ATL', 'LGA', '2026-04-14');
    const flight = result.flights[0];
    const cascade = flight.factorsDetailed.find(f => f.name === 'Cascade Boost');
    expect(cascade?.score).toBe(13);
  });
});
