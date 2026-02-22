import express from 'express';
import dotenv from 'dotenv';
import { getWeatherAlerts, fetchMetar } from './weather.js';
import { scoreFlights } from './scoring.js';
import { cacheGet, cacheSet } from './cache.js';
import {
  CARRIER_STATS,
  QUARTERLY_TRENDS,
  TOP_OVERSOLD_ROUTES,
  ALL_HUBS,
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
// Flight Search with Bump Scoring
// GET /api/flights/search?origin=ATL&dest=LGA&date=2026-03-01
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
    const cacheKey = `flights:${originStr}:${destStr}:${dateStr}`;
    const cached = cacheGet<any>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const flights = await scoreFlights(originStr, destStr, dateStr);

    // Determine which data sources were used
    const openskyCount = flights.filter((f: any) => f.dataSource === 'opensky').length;
    const scheduleCount = flights.filter((f: any) => f.dataSource === 'schedule').length;
    const dataSources = [
      'BTS load factors',
      'BTS denied boarding rates',
      'aviationweather.gov METAR',
      'DOT carrier statistics',
    ];
    if (openskyCount > 0) dataSources.unshift('OpenSky Network (live flights)');
    if (scheduleCount > 0) dataSources.push('Schedule templates (supplemental)');

    const result = {
      flights,
      meta: {
        origin: originStr,
        destination: destStr,
        date: dateStr,
        totalFlights: flights.length,
        realFlights: openskyCount,
        scheduleFlights: scheduleCount,
        dataSources,
        timestamp: new Date().toISOString(),
      },
    };

    // Cache for 5 minutes
    cacheSet(cacheKey, result, 5 * 60 * 1000);
    res.json(result);
  } catch (err) {
    console.error('Flight search error:', err);
    res.status(500).json({ error: 'Flight search failed', flights: [] });
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

  // Sort by VDB rate descending (most bumps first)
  carriers.sort((a, b) => b.vdbRate - a.vdbRate);

  res.json({
    carriers,
    source: 'DOT Bureau of Transportation Statistics',
    note: 'Rates are per 10,000 enplanements',
  });
});

// =============================================================================
// Quarterly Trends
// GET /api/stats/trends
// =============================================================================
app.get('/api/stats/trends', (_req, res) => {
  res.json({
    trends: QUARTERLY_TRENDS,
    source: 'DOT Air Travel Consumer Report',
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
    const avgComp = Math.round(QUARTERLY_TRENDS.reduce((sum, q) => sum + q.avgCompensation, 0) / QUARTERLY_TRENDS.length);

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
  console.log('   Data sources: OpenSky Network, aviationweather.gov, DOT BTS');
  console.log('   Endpoints:');
  console.log('     GET /api/health');
  console.log('     GET /api/weather/alerts');
  console.log('     GET /api/weather/metar');
  console.log('     GET /api/flights/search');
  console.log('     GET /api/stats/carriers');
  console.log('     GET /api/stats/trends');
  console.log('     GET /api/stats/routes');
  console.log('     GET /api/stats/summary');
});
