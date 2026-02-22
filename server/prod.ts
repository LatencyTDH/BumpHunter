/**
 * Production server: serves the Vite-built static files AND the Express API
 * over HTTPS on a single port (default 8443).
 */
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import dotenv from 'dotenv';

// ── env ──────────────────────────────────────────────────────────────────────
dotenv.config({ path: '.env.local' });
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 8443;

// ── Import all API route handlers from the main server ───────────────────────
import { getWeatherAlerts, fetchMetar } from './weather.js';
import { scoreFlights, scoreOriginDepartures } from './scoring.js';
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

// ── Express app ──────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// --- API routes (copied from index.ts) ---

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/weather/alerts', async (req, res) => {
  try {
    const hubs = req.query.hubs
      ? String(req.query.hubs).split(',').map(h => h.trim().toUpperCase())
      : ALL_HUBS;
    const alerts = await getWeatherAlerts(hubs);
    res.json({ alerts, hubs, source: 'aviationweather.gov', timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('Weather alerts error:', err);
    res.status(500).json({ error: 'Failed to fetch weather data', alerts: [] });
  }
});

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

app.get('/api/faa/status', async (req, res) => {
  try {
    const airport = req.query.airport ? String(req.query.airport).toUpperCase() : null;
    if (!airport) return res.status(400).json({ error: 'airport query parameter is required' });
    const status = await getAirportStatus(airport);
    res.json({ ...status, source: 'FAA NASSTATUS', timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('FAA status error:', err);
    res.status(500).json({ error: 'Failed to fetch FAA status', airport: req.query.airport, delay: false });
  }
});

app.get('/api/flights/search', async (req, res) => {
  try {
    const { origin, dest, date } = req.query;
    if (!origin || !date) return res.status(400).json({ error: 'origin and date are required' });

    const originStr = String(origin).toUpperCase();
    const destStr = dest ? String(dest).toUpperCase() : '';
    const dateStr = String(date);
    const anyDestination = !destStr || destStr === 'ANY';
    const destKey = anyDestination ? 'ANY' : destStr;
    const cacheKey = `flights:${originStr}:${destKey}:${dateStr}:v4`;
    const cached = cacheGet<any>(cacheKey);
    if (cached) return res.json(cached);

    const scoreResult = anyDestination
      ? await scoreOriginDepartures(originStr, dateStr)
      : await scoreFlights(originStr, destStr, dateStr);

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
        destination: destKey,
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

    cacheSet(cacheKey, result, 5 * 60 * 1000);
    res.json(result);
  } catch (err) {
    console.error('Flight search error:', err);
    res.status(500).json({
      error: 'Flight search failed',
      flights: [],
      meta: { totalFlights: 0, dataSource: 'none', message: 'An error occurred while searching for flights.', rateLimited: false },
    });
  }
});

app.get('/api/flights/heatmap', (req, res) => {
  try {
    const { origin, dest, weeks } = req.query;
    if (!origin || !dest) return res.status(400).json({ error: 'origin and dest are required' });

    const originStr = String(origin).toUpperCase();
    const destStr = String(dest).toUpperCase();
    const weeksNum = weeks ? parseInt(String(weeks), 10) : 4;
    const safeWeeks = Number.isFinite(weeksNum) ? Math.min(Math.max(weeksNum, 1), 12) : 4;

    const cacheKey = `heatmap:${originStr}:${destStr}:${safeWeeks}`;
    const cached = cacheGet<any>(cacheKey);
    if (cached) return res.json(cached);

    const days = buildHeatmap(originStr, destStr, safeWeeks);
    cacheSet(cacheKey, days, 12 * 60 * 60 * 1000);
    res.json(days);
  } catch (err) {
    console.error('Heatmap error:', err);
    res.status(500).json({ error: 'Failed to build heatmap' });
  }
});

app.get('/api/flights/lookup', async (req, res) => {
  try {
    const { flight, date } = req.query;
    if (!flight || !date) return res.status(400).json({ error: 'flight and date are required' });

    const flightRaw = String(flight).replace(/\s+/g, '').toUpperCase();
    const dateStr = String(date);
    const match = flightRaw.match(/^([A-Z]{2})(\d+)$/);
    if (!match) return res.status(400).json({ error: 'Flight must look like DL323' });

    const normalizedFlight = `${match[1]}${match[2]}`;
    const cacheKey = `lookup:${normalizedFlight}:${dateStr}:v1`;
    const cached = cacheGet<any>(cacheKey);
    if (cached) return res.json(cached);

    let origin: string | null = null;
    let destination: string | null = null;
    for (const hub of ALL_HUBS) {
      const schedule = await getFR24ScheduleDepartures(hub, dateStr);
      if (schedule.error) continue;
      const found = schedule.flights.find(f => f.flightNumber.toUpperCase() === normalizedFlight);
      if (found) { origin = hub; destination = found.destination.toUpperCase(); break; }
    }

    if (!origin || !destination) {
      const result = { flight: null, meta: { flightNumber: normalizedFlight, date: dateStr, message: 'Flight not found in FR24 schedules for major hubs.', timestamp: new Date().toISOString() } };
      cacheSet(cacheKey, result, 5 * 60 * 1000);
      return res.json(result);
    }

    const scored = await scoreFlights(origin, destination, dateStr);
    const scoredFlight = scored.flights.find(f => f.flightNumber.replace(/\s+/g, '') === normalizedFlight) || null;
    const result = { flight: scoredFlight, meta: { flightNumber: normalizedFlight, date: dateStr, origin, destination, dataSources: scored.dataSources, message: scoredFlight ? null : 'Flight found in schedule but not available in scored results.', timestamp: new Date().toISOString() } };
    cacheSet(cacheKey, result, 5 * 60 * 1000);
    return res.json(result);
  } catch (err) {
    console.error('Flight lookup error:', err);
    return res.status(500).json({ error: 'Flight lookup failed' });
  }
});

app.get('/api/stats/carriers', (_req, res) => {
  const carriers = Object.values(CARRIER_STATS).map(c => ({ ...c, loadFactorPct: Math.round(c.loadFactor * 100 * 10) / 10 }));
  carriers.sort((a, b) => b.vdbRate - a.vdbRate);
  res.json({ carriers, source: 'DOT Air Travel Consumer Report (November 2025)', note: `Rates are per 10,000 enplanements (${BTS_DATA_PERIOD}).`, dataNote: BTS_DATA_NOTE, dataWarning: BTS_DATA_WARNING });
});

app.get('/api/stats/trends', (_req, res) => {
  res.json({ trends: QUARTERLY_TRENDS, source: 'DOT Air Travel Consumer Report / BTS', dataNote: `Quarterly trends from BTS historical data (2019-2021). Current carrier rates from DOT ATCR ${BTS_DATA_PERIOD}.` });
});

app.get('/api/stats/routes', (_req, res) => {
  res.json({ routes: TOP_OVERSOLD_ROUTES, source: 'DOT Bureau of Transportation Statistics', dataNote: `Based on ${BTS_DATA_PERIOD} data.`, dataWarning: BTS_DATA_WARNING });
});

app.get('/api/stats/summary', async (_req, res) => {
  try {
    const alerts = await getWeatherAlerts(ALL_HUBS);
    const latestQuarter = QUARTERLY_TRENDS[QUARTERLY_TRENDS.length - 1];
    const totalVDB = QUARTERLY_TRENDS.reduce((sum, q) => sum + q.voluntaryDB, 0);
    const quartersWithComp = QUARTERLY_TRENDS.filter(q => q.avgCompensation !== null && q.avgCompensation > 0);
    const avgComp = quartersWithComp.length > 0
      ? Math.round(quartersWithComp.reduce((sum, q) => sum + (q.avgCompensation || 0), 0) / quartersWithComp.length)
      : 600;
    res.json({ activeAlerts: alerts.length, severeAlerts: alerts.filter(a => a.severity === 'severe').length, latestQuarter: latestQuarter.quarter, quarterlyVDB: latestQuarter.voluntaryDB, avgCompensation: avgComp, totalVDBTwoYears: totalVDB, topCarrier: Object.values(CARRIER_STATS).sort((a, b) => b.vdbRate - a.vdbRate)[0], alerts });
  } catch (err) {
    console.error('Summary error:', err);
    res.status(500).json({ error: 'Failed to generate summary' });
  }
});

// --- Static files (Vite build output) ---
app.use(express.static(path.join(ROOT, 'dist')));

// SPA fallback: serve index.html for any non-API route
app.get('*', (_req, res) => {
  res.sendFile(path.join(ROOT, 'dist', 'index.html'));
});

// ── HTTP server ──────────────────────────────────────────────────────────────
http.createServer(app).listen(PORT, '0.0.0.0', () => {
  console.log(`🛫 BumpHunter PRODUCTION running on http://0.0.0.0:${PORT}`);
  console.log(`   Access via: http://pql.flicker-ulmer.ts.net:${PORT}`);
  console.log('   Serving: Vite build (dist/) + Express API (/api/*)');
});
