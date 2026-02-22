import express from 'express';
import dotenv from 'dotenv';
import { getWeatherAlerts, fetchMetar } from './weather.js';
import { scoreFlights } from './scoring.js';
import { cacheGet, cacheSet } from './cache.js';
import { buildHeatmap } from './heatmap.js';
import { getAirportStatus } from './faa.js';
import { getFR24ScheduleDepartures } from './fr24.js';
import {
  CARRIER_STATS,
  QUARTERLY_TRENDS,
  TOP_OVERSOLD_ROUTES,
  ALL_HUBS,
  BTS_DATA_PERIOD,
  BTS_DATA_NOTE,
  BTS_DATA_WARNING,
} from './data.js';

dotenv.config({ path: '.env.local' });
dotenv.config();

const app = express();
const PORT = process.env.API_PORT || 3001;

app.use(express.json());

// =============================================================================
// Health check
// =============================================================================
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// =============================================================================
// Weather Alerts
// GET /api/weather/alerts?hubs=ATL,EWR,DFW
// =============================================================================
app.get('/api/weather/alerts', async (req, res) => {
  try {
    const hubs = req.query.hubs
      ? String(req.query.hubs).split(',').map(h => h.trim().toUpperCase())
      : ALL_HUBS;

    const alerts = await getWeatherAlerts(hubs);
    res.json({
      alerts,
      hubs,
      source: 'aviationweather.gov',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Weather alerts error:', err);
    res.status(500).json({ error: 'Failed to fetch weather data', alerts: [] });
  }
});

// =============================================================================
// METAR data for specific airports
// GET /api/weather/metar?airports=ATL,ORD
// =============================================================================
app.get('/api/weather/metar', async (req, res) => {
  try {
    const airports = req.query.airports
      ? String(req.query.airports).split(',').map(a => a.trim().toUpperCase())
      : ALL_HUBS;

    const metars = await fetchMetar(airports);
    res.json({ metars, source: 'aviationweather.gov' });
  } catch (err) {
    console.error('METAR error:', err);
    res.status(500).json({ error: 'Failed to fetch METAR data', metars: [] });
  }
});

// =============================================================================
// FAA Airport Status
// GET /api/faa/status?airport=ATL
// =============================================================================
app.get('/api/faa/status', async (req, res) => {
  try {
    const airport = req.query.airport ? String(req.query.airport).toUpperCase() : null;
    if (!airport) {
      return res.status(400).json({ error: 'airport query parameter is required' });
    }

    const status = await getAirportStatus(airport);
    res.json({
      ...status,
      source: 'FAA NASSTATUS',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('FAA status error:', err);
    res.status(500).json({ error: 'Failed to fetch FAA status', airport: req.query.airport, delay: false });
  }
});

// =============================================================================
// Flight Search with Bump Scoring
// GET /api/flights/search?origin=ATL&dest=LGA&date=2026-03-01
//
// Returns ONLY real flights from FR24 + OpenSky + ADSBDB.
// NO fake data. NO schedule templates. EVER.
// If no data is available, returns empty list with honest explanation.
// =============================================================================
app.get('/api/flights/search', async (req, res) => {
  try {
    const { origin, dest, date } = req.query;

    if (!origin || !dest || !date) {
      return res.status(400).json({ error: 'origin, dest, and date are required' });
    }

    const originStr = String(origin).toUpperCase();
    const destStr = String(dest).toUpperCase();
    const dateStr = String(date);

    // Check cache first
    const cacheKey = `flights:${originStr}:${destStr}:${dateStr}:v3`;
    const cached = cacheGet<any>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const scoreResult = await scoreFlights(originStr, destStr, dateStr);

    // Build data sources list
    const dataSources = [
      ...scoreResult.dataSources,
      'aviationweather.gov METAR',
      'DOT BTS Statistics',
    ];
    if (scoreResult.verifiedCount > 0 && !dataSources.some(s => s.includes('ADSBDB'))) {
      dataSources.push('ADSBDB (route verification)');
    }

    const result = {
      flights: scoreResult.flights,
      meta: {
        origin: originStr,
        destination: destStr,
        date: dateStr,
        totalFlights: scoreResult.flights.length,
        verifiedFlights: scoreResult.verifiedCount,
        dataSources,
        dataSource: scoreResult.flights.length > 0 ? 'live' : 'none',
        message: scoreResult.message,
        rateLimited: scoreResult.rateLimited,
        openskyRateLimited: scoreResult.openskyRateLimited,
        btsDataPeriod: scoreResult.btsDataPeriod,
        btsDataWarning: scoreResult.btsDataWarning,
        timestamp: new Date().toISOString(),
      },
    };

    // Cache for 5 minutes
    cacheSet(cacheKey, result, 5 * 60 * 1000);
    res.json(result);
  } catch (err) {
    console.error('Flight search error:', err);
    res.status(500).json({
      error: 'Flight search failed',
      flights: [],
      meta: {
        totalFlights: 0,
        dataSource: 'none',
        message: 'An error occurred while searching for flights. Please try again.',
        rateLimited: false,
      },
    });
  }
});

// =============================================================================
// Best Day to Fly Heatmap
// GET /api/flights/heatmap?origin=ATL&dest=LGA&weeks=4
// =============================================================================
app.get('/api/flights/heatmap', (req, res) => {
  try {
    const { origin, dest, weeks } = req.query;
    if (!origin || !dest) {
      return res.status(400).json({ error: 'origin and dest are required' });
    }

    const originStr = String(origin).toUpperCase();
    const destStr = String(dest).toUpperCase();
    const weeksNum = weeks ? parseInt(String(weeks), 10) : 4;
    const safeWeeks = Number.isFinite(weeksNum) ? Math.min(Math.max(weeksNum, 1), 12) : 4;

    const cacheKey = `heatmap:${originStr}:${destStr}:${safeWeeks}`;
    const cached = cacheGet<any>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const days = buildHeatmap(originStr, destStr, safeWeeks);
    cacheSet(cacheKey, days, 12 * 60 * 60 * 1000);
    res.json(days);
  } catch (err) {
    console.error('Heatmap error:', err);
    res.status(500).json({ error: 'Failed to build heatmap' });
  }
});

// =============================================================================
// Flight Lookup by Flight Number
// GET /api/flights/lookup?flight=DL323&date=2026-03-08
// =============================================================================
app.get('/api/flights/lookup', async (req, res) => {
  try {
    const { flight, date } = req.query;
    if (!flight || !date) {
      return res.status(400).json({ error: 'flight and date are required' });
    }

    const flightRaw = String(flight).replace(/\s+/g, '').toUpperCase();
    const dateStr = String(date);
    const match = flightRaw.match(/^([A-Z]{2})(\d+)$/);
    if (!match) {
      return res.status(400).json({ error: 'Flight must look like DL323' });
    }

    const normalizedFlight = `${match[1]}${match[2]}`;
    const cacheKey = `lookup:${normalizedFlight}:${dateStr}:v1`;
    const cached = cacheGet<any>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    let origin: string | null = null;
    let destination: string | null = null;

    for (const hub of ALL_HUBS) {
      const schedule = await getFR24ScheduleDepartures(hub, dateStr);
      if (schedule.error) continue;

      const found = schedule.flights.find(f => f.flightNumber.toUpperCase() === normalizedFlight);
      if (found) {
        origin = hub;
        destination = found.destination.toUpperCase();
        break;
      }
    }

    if (!origin || !destination) {
      const result = {
        flight: null,
        meta: {
          flightNumber: normalizedFlight,
          date: dateStr,
          message: 'Flight not found in FR24 schedules for major hubs.',
          timestamp: new Date().toISOString(),
        },
      };
      cacheSet(cacheKey, result, 5 * 60 * 1000);
      return res.json(result);
    }

    const scored = await scoreFlights(origin, destination, dateStr);
    const scoredFlight = scored.flights.find(f => f.flightNumber.replace(/\s+/g, '') === normalizedFlight) || null;

    const result = {
      flight: scoredFlight,
      meta: {
        flightNumber: normalizedFlight,
        date: dateStr,
        origin,
        destination,
        dataSources: scored.dataSources,
        message: scoredFlight ? null : 'Flight found in schedule but not available in scored results.',
        timestamp: new Date().toISOString(),
      },
    };

    cacheSet(cacheKey, result, 5 * 60 * 1000);
    return res.json(result);
  } catch (err) {
    console.error('Flight lookup error:', err);
    return res.status(500).json({ error: 'Flight lookup failed' });
  }
});

// =============================================================================
// Carrier Statistics (BTS data)
// GET /api/stats/carriers
// =============================================================================
app.get('/api/stats/carriers', (_req, res) => {
  const carriers = Object.values(CARRIER_STATS).map(c => ({
    ...c,
    loadFactorPct: Math.round(c.loadFactor * 100 * 10) / 10,
  }));

  carriers.sort((a, b) => b.vdbRate - a.vdbRate);

  res.json({
    carriers,
    source: 'DOT Air Travel Consumer Report (November 2025)',
    note: `Rates are per 10,000 enplanements (${BTS_DATA_PERIOD}). Operating carrier data — who flies the plane, not who sold the ticket. VDB compensation uses DOT-published industry averages (~$600).`,
    dataNote: BTS_DATA_NOTE,
    dataWarning: BTS_DATA_WARNING,
  });
});

// =============================================================================
// Quarterly Trends
// GET /api/stats/trends
// =============================================================================
app.get('/api/stats/trends', (_req, res) => {
  res.json({
    trends: QUARTERLY_TRENDS,
    source: 'DOT Air Travel Consumer Report / BTS',
    dataNote: `Quarterly trends from BTS historical data (2019-2021). Current carrier rates from DOT ATCR ${BTS_DATA_PERIOD}.`,
  });
});

// =============================================================================
// Top Oversold Routes
// GET /api/stats/routes
// =============================================================================
app.get('/api/stats/routes', (_req, res) => {
  res.json({
    routes: TOP_OVERSOLD_ROUTES,
    source: 'DOT Bureau of Transportation Statistics',
    dataNote: `Based on ${BTS_DATA_PERIOD} data. Compensation uses DOT-published industry averages where BTS data reports $0.`,
    dataWarning: BTS_DATA_WARNING,
  });
});

// =============================================================================
// Summary Stats (for dashboard)
// GET /api/stats/summary
// =============================================================================
app.get('/api/stats/summary', async (_req, res) => {
  try {
    const alerts = await getWeatherAlerts(ALL_HUBS);
    const latestQuarter = QUARTERLY_TRENDS[QUARTERLY_TRENDS.length - 1];
    const totalVDB = QUARTERLY_TRENDS.reduce((sum, q) => sum + q.voluntaryDB, 0);

    // Average compensation: use only quarters with meaningful data
    const quartersWithComp = QUARTERLY_TRENDS.filter(q => q.avgCompensation !== null && q.avgCompensation > 0);
    const avgComp = quartersWithComp.length > 0
      ? Math.round(quartersWithComp.reduce((sum, q) => sum + (q.avgCompensation || 0), 0) / quartersWithComp.length)
      : 600; // DOT industry average fallback

    res.json({
      activeAlerts: alerts.length,
      severeAlerts: alerts.filter(a => a.severity === 'severe').length,
      latestQuarter: latestQuarter.quarter,
      quarterlyVDB: latestQuarter.voluntaryDB,
      avgCompensation: avgComp,
      totalVDBTwoYears: totalVDB,
      topCarrier: Object.values(CARRIER_STATS).sort((a, b) => b.vdbRate - a.vdbRate)[0],
      alerts,
    });
  } catch (err) {
    console.error('Summary error:', err);
    res.status(500).json({ error: 'Failed to generate summary' });
  }
});

// =============================================================================
// Start server
// =============================================================================
app.listen(PORT, () => {
  console.log(`🛫 BumpHunter API running on http://localhost:${PORT}`);
  console.log('   Data sources: FlightRadar24, OpenSky Network, ADSBDB, aviationweather.gov, FAA NASSTATUS, DOT BTS');
  console.log('   NO fake data. NO schedule templates. Real flights only.');
  console.log('   Endpoints:');
  console.log('     GET /api/health');
  console.log('     GET /api/weather/alerts');
  console.log('     GET /api/weather/metar');
  console.log('     GET /api/faa/status');
  console.log('     GET /api/flights/search');
  console.log('     GET /api/stats/carriers');
  console.log('     GET /api/stats/trends');
  console.log('     GET /api/stats/routes');
  console.log('     GET /api/stats/summary');
});
