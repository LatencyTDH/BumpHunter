import { cacheGet, cacheSet } from './cache.js';
import { AIRPORT_ICAO, ALL_HUBS } from './data.js';

// =============================================================================
// aviationweather.gov METAR/TAF service — FREE, no API key required
// =============================================================================

const METAR_URL = 'https://aviationweather.gov/api/data/metar';
const TAF_URL = 'https://aviationweather.gov/api/data/taf';
const METAR_CACHE_TTL = 15 * 60 * 1000; // 15 minutes
const TAF_CACHE_TTL = 30 * 60 * 1000;   // 30 minutes

type MetarCloud = { cover: string; base: number };

export type MetarData = {
  icaoId: string;
  name: string;
  rawOb: string;
  temp: number | null;
  dewp: number | null;
  wdir: number | null;
  wspd: number | null;
  wgst: number | null;
  visib: string | null;
  wxString: string | null;
  clouds: MetarCloud[];
  fltcat: string | null; // VFR, MVFR, IFR, LIFR
  reportTime: string;
};

export type WeatherAlert = {
  id: string;
  hub: string;
  airportName: string;
  severity: 'severe' | 'moderate' | 'minor';
  reason: string;
  impact: string;
  details: string;
  color: string;
  bg: string;
  border: string;
  rawMetar: string;
};

function parseVisibility(visib: string | null): number {
  if (!visib) return 10;
  const cleaned = visib.replace('+', '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 10 : num;
}

function analyzeWeather(metar: MetarData): WeatherAlert | null {
  const hub = Object.entries(AIRPORT_ICAO).find(([_, icao]) => icao === metar.icaoId)?.[0];
  if (!hub) return null;

  const wx = (metar.wxString || '').toUpperCase();
  const vis = parseVisibility(metar.visib);
  const gust = metar.wgst || 0;
  const wspd = metar.wspd || 0;
  const fltcat = (metar.fltcat || 'VFR').toUpperCase();
  const ceiling = metar.clouds.find(c => c.cover === 'OVC' || c.cover === 'BKN')?.base || 99999;

  // Severe conditions
  if (wx.includes('TS') || wx.includes('+TS')) {
    return {
      id: `wx-${hub}-ts`,
      hub,
      airportName: metar.name || hub,
      severity: 'severe',
      reason: wx.includes('+TS') ? 'Heavy Thunderstorms' : 'Thunderstorms',
      impact: 'Expect ground stops, cascading delays, and rebooking waves. Evening flights will be heavily oversold.',
      details: `Visibility: ${vis}SM | Wind: ${wspd}kt gusting ${gust}kt | Ceiling: ${ceiling}ft`,
      color: 'text-rose-500',
      bg: 'bg-rose-500/10',
      border: 'border-rose-500/20',
      rawMetar: metar.rawOb,
    };
  }

  if (wx.includes('FZRA') || wx.includes('FZDZ') || wx.includes('PL')) {
    return {
      id: `wx-${hub}-ice`,
      hub,
      airportName: metar.name || hub,
      severity: 'severe',
      reason: 'Freezing Precipitation',
      impact: 'De-icing delays and possible ground stops. High cancellation risk drives oversales on remaining flights.',
      details: `Conditions: ${wx} | Visibility: ${vis}SM | Temp: ${metar.temp}°C`,
      color: 'text-rose-500',
      bg: 'bg-rose-500/10',
      border: 'border-rose-500/20',
      rawMetar: metar.rawOb,
    };
  }

  if (fltcat === 'LIFR' || vis < 0.5) {
    return {
      id: `wx-${hub}-lifr`,
      hub,
      airportName: metar.name || hub,
      severity: 'severe',
      reason: 'Very Low Visibility (LIFR)',
      impact: 'Instrument approach restrictions causing heavy delays. Rebooking passengers creates oversale opportunities.',
      details: `Visibility: ${vis}SM | Ceiling: ${ceiling}ft | Flight Category: LIFR`,
      color: 'text-rose-500',
      bg: 'bg-rose-500/10',
      border: 'border-rose-500/20',
      rawMetar: metar.rawOb,
    };
  }

  // Heavy snow
  if (wx.includes('+SN') || (wx.includes('SN') && vis < 2)) {
    return {
      id: `wx-${hub}-snow`,
      hub,
      airportName: metar.name || hub,
      severity: 'severe',
      reason: 'Heavy Snow',
      impact: 'Runway clearing operations causing ground delays. Cancelled flights mean oversold rebookings.',
      details: `Visibility: ${vis}SM | Wind: ${wspd}kt gusting ${gust}kt`,
      color: 'text-rose-500',
      bg: 'bg-rose-500/10',
      border: 'border-rose-500/20',
      rawMetar: metar.rawOb,
    };
  }

  // Moderate conditions
  if (gust >= 35 || wspd >= 30) {
    return {
      id: `wx-${hub}-wind`,
      hub,
      airportName: metar.name || hub,
      severity: 'moderate',
      reason: 'High Winds',
      impact: `Gusts of ${gust}kt causing crosswind limitations. Regional jets weight-restricted — guaranteed bump candidates.`,
      details: `Wind: ${wspd}kt gusting ${gust}kt | Direction: ${metar.wdir}°`,
      color: 'text-amber-500',
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/20',
      rawMetar: metar.rawOb,
    };
  }

  if (fltcat === 'IFR' || (vis < 3 && vis >= 0.5)) {
    return {
      id: `wx-${hub}-ifr`,
      hub,
      airportName: metar.name || hub,
      severity: 'moderate',
      reason: 'Low Visibility (IFR)',
      impact: 'Reduced arrival rates causing delays. Misconnecting passengers increase oversale probability.',
      details: `Visibility: ${vis}SM | Ceiling: ${ceiling}ft | Flight Category: IFR`,
      color: 'text-amber-500',
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/20',
      rawMetar: metar.rawOb,
    };
  }

  if (wx.includes('SN') || wx.includes('-SN')) {
    return {
      id: `wx-${hub}-ltsn`,
      hub,
      airportName: metar.name || hub,
      severity: 'moderate',
      reason: 'Snow',
      impact: 'De-icing requirements and reduced visibility may cause departure delays and misconnections.',
      details: `Conditions: ${wx} | Visibility: ${vis}SM`,
      color: 'text-amber-500',
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/20',
      rawMetar: metar.rawOb,
    };
  }

  if (wx.includes('FG') && vis < 3) {
    return {
      id: `wx-${hub}-fog`,
      hub,
      airportName: metar.name || hub,
      severity: 'moderate',
      reason: 'Dense Fog',
      impact: 'Ground delay programs likely. Morning fog creates cascading delays throughout the day.',
      details: `Visibility: ${vis}SM | Ceiling: ${ceiling}ft`,
      color: 'text-amber-500',
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/20',
      rawMetar: metar.rawOb,
    };
  }

  // Minor conditions
  if (fltcat === 'MVFR') {
    return {
      id: `wx-${hub}-mvfr`,
      hub,
      airportName: metar.name || hub,
      severity: 'minor',
      reason: 'Marginal Conditions (MVFR)',
      impact: 'Slightly reduced arrival rates. Minor delays may cause misconnections on tight layovers.',
      details: `Visibility: ${vis}SM | Ceiling: ${ceiling}ft | Flight Category: MVFR`,
      color: 'text-blue-400',
      bg: 'bg-blue-500/10',
      border: 'border-blue-500/20',
      rawMetar: metar.rawOb,
    };
  }

  if (gust >= 25) {
    return {
      id: `wx-${hub}-gusty`,
      hub,
      airportName: metar.name || hub,
      severity: 'minor',
      reason: 'Gusty Winds',
      impact: `Wind gusts to ${gust}kt. Regional jets may face weight restrictions on shorter runways.`,
      details: `Wind: ${wspd}kt gusting ${gust}kt`,
      color: 'text-blue-400',
      bg: 'bg-blue-500/10',
      border: 'border-blue-500/20',
      rawMetar: metar.rawOb,
    };
  }

  return null;
}

export async function fetchMetar(airports: string[]): Promise<MetarData[]> {
  const icaos = airports
    .map(a => AIRPORT_ICAO[a.toUpperCase()] || a.toUpperCase())
    .filter(Boolean);

  if (icaos.length === 0) return [];

  const cacheKey = `metar:${icaos.sort().join(',')}`;
  const cached = cacheGet<MetarData[]>(cacheKey);
  if (cached) return cached;

  try {
    const url = `${METAR_URL}?ids=${icaos.join(',')}&format=json`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      console.warn(`METAR fetch failed: ${res.status} ${res.statusText}`);
      return [];
    }

    const data = await res.json() as any[];
    const metars: MetarData[] = data.map(d => ({
      icaoId: d.icaoId,
      name: d.name || '',
      rawOb: d.rawOb || '',
      temp: d.temp ?? null,
      dewp: d.dewp ?? null,
      wdir: d.wdir ?? null,
      wspd: d.wspd ?? null,
      wgst: d.wgst ?? null,
      visib: d.visib != null ? String(d.visib) : null,
      wxString: d.wxString || null,
      clouds: d.clouds || [],
      fltcat: d.fltcat || null,
      reportTime: d.reportTime || new Date().toISOString(),
    }));

    cacheSet(cacheKey, metars, METAR_CACHE_TTL);
    return metars;
  } catch (err) {
    console.warn('METAR fetch error:', err);
    return [];
  }
}

export async function getWeatherAlerts(hubs?: string[]): Promise<WeatherAlert[]> {
  const airports = hubs || ALL_HUBS;
  const cacheKey = `alerts:${airports.sort().join(',')}`;
  const cached = cacheGet<WeatherAlert[]>(cacheKey);
  if (cached) return cached;

  const metars = await fetchMetar(airports);
  const alerts: WeatherAlert[] = [];

  for (const metar of metars) {
    const alert = analyzeWeather(metar);
    if (alert) alerts.push(alert);
  }

  // Sort: severe first, then moderate, then minor
  const severityOrder = { severe: 0, moderate: 1, minor: 2 };
  alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  cacheSet(cacheKey, alerts, METAR_CACHE_TTL);
  return alerts;
}

// Get weather severity score for a specific airport (used by scoring algorithm)
export async function getWeatherSeverity(airport: string): Promise<{ score: number; reason: string | null }> {
  const icao = AIRPORT_ICAO[airport.toUpperCase()] || airport.toUpperCase();
  const metars = await fetchMetar([airport]);
  const metar = metars.find(m => m.icaoId === icao);

  if (!metar) return { score: 0, reason: null };

  const alert = analyzeWeather(metar);
  if (!alert) return { score: 0, reason: null };

  switch (alert.severity) {
    case 'severe': return { score: 25, reason: `${alert.reason} at ${airport}` };
    case 'moderate': return { score: 15, reason: `${alert.reason} at ${airport}` };
    case 'minor': return { score: 8, reason: `${alert.reason} at ${airport}` };
    default: return { score: 0, reason: null };
  }
}
