// =============================================================================
// FlightRadar24 Airport Schedule API + Live Feed Client
//
// Two data sources:
//   1. Schedule API — returns SCHEDULED departures (past, present, future)
//      Works 24/7, shows all flights for a given day regardless of time.
//   2. Live Feed — flights currently airborne (used to overlay "In Air" status)
//
// No API key required. User-Agent header only.
// =============================================================================

import { cacheGet, cacheSet } from './cache.js';

// =============================================================================
// Schedule API Types & Constants
// =============================================================================

const FR24_SCHEDULE_BASE = 'https://api.flightradar24.com/common/v1/airport.json';
const FR24_SCHEDULE_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const FR24_MAX_PAGES = 5; // Up to 500 flights

export type FR24ScheduleFlight = {
  flightNumber: string;      // "DL323"
  callsign: string;          // "DAL323"
  codeshares: string[];      // ["AF6825", "KE7079"]
  destination: string;       // IATA code "LGA"
  destinationName: string;   // "New York LaGuardia Airport"
  aircraftCode: string;      // "A321"
  aircraftName: string;      // "Airbus A321-211"
  registration: string;      // "N848DN"
  airline: string;           // "Delta Air Lines"
  airlineIata: string;       // "DL"
  airlineIcao: string;       // "DAL"
  status: string;            // "Estimated dep 07:48"
  isLive: boolean;           // currently airborne
  departureTimestamp: number; // Unix seconds
  depTime: string;           // "07:48" (ET)
};

export type FR24ScheduleResult = {
  flights: FR24ScheduleFlight[];
  totalFlights: number;
  error: string | null;
};

// =============================================================================
// Schedule API — Fetch a single page
// =============================================================================

async function fetchSchedulePage(
  airportCode: string,
  timestamp: number,
  page: number,
): Promise<{ data: any[]; totalPages: number; totalItems: number } | null> {
  // Build URL with properly encoded bracket params
  const url =
    `${FR24_SCHEDULE_BASE}?code=${encodeURIComponent(airportCode)}` +
    `&plugin%5B%5D=schedule` +
    `&plugin-setting%5Bschedule%5D%5Bmode%5D=departures` +
    `&plugin-setting%5Bschedule%5D%5Btimestamp%5D=${timestamp}` +
    `&limit=100` +
    `&page=${page}`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) {
      console.warn(`[FR24-Schedule] Page ${page} failed: HTTP ${res.status}`);
      return null;
    }

    const json = await res.json();
    const schedule = json?.result?.response?.airport?.pluginData?.schedule;
    if (!schedule?.departures) {
      console.warn(`[FR24-Schedule] No departures data in response`);
      return null;
    }

    return {
      data: schedule.departures.data || [],
      totalPages: schedule.departures.page?.total || 1,
      totalItems: schedule.departures.item?.total || 0,
    };
  } catch (err) {
    console.warn(`[FR24-Schedule] Fetch error page ${page}:`, err);
    return null;
  }
}

// =============================================================================
// Schedule API — Parse a single flight from raw response
// =============================================================================

function parseScheduleFlight(raw: any): FR24ScheduleFlight | null {
  try {
    const flight = raw?.flight;
    if (!flight) return null;

    const ident = flight.identification;
    const dest = flight.airport?.destination;
    const aircraft = flight.aircraft;
    const owner = flight.owner;
    const status = flight.status;
    const time = flight.time;

    // Must have at minimum a flight number and destination
    const flightNumber = ident?.number?.default || null;
    const destIata = dest?.code?.iata || null;
    if (!flightNumber || !destIata) return null;

    // Get departure timestamp — try multiple sources
    let depTs: number | null = null;
    depTs = time?.scheduled?.departure || null;
    if (!depTs) depTs = time?.estimated?.departure || null;
    if (!depTs) depTs = time?.real?.departure || null;
    if (!depTs && status?.generic?.eventTime?.utc) depTs = status.generic.eventTime.utc;
    if (!depTs) return null; // Can't place this flight in time

    // Format departure time in ET
    const depDate = new Date(depTs * 1000);
    const depTimeStr = depDate.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'America/New_York',
    });

    return {
      flightNumber,
      callsign: ident?.callsign || '',
      codeshares: Array.isArray(ident?.codeshare) ? ident.codeshare : [],
      destination: destIata.toUpperCase(),
      destinationName: dest?.name || '',
      aircraftCode: aircraft?.model?.code || '',
      aircraftName: aircraft?.model?.text || '',
      registration: aircraft?.registration || '',
      airline: owner?.name || '',
      airlineIata: owner?.code?.iata || '',
      airlineIcao: owner?.code?.icao || '',
      status: status?.text || '',
      isLive: !!status?.live,
      departureTimestamp: depTs,
      depTime: depTimeStr,
    };
  } catch {
    return null;
  }
}

// =============================================================================
// Schedule API — Fetch all departures for an airport+date (paginated, cached)
// =============================================================================

export async function getFR24ScheduleDepartures(
  airportCode: string,
  dateStr: string,
): Promise<FR24ScheduleResult> {
  const code = airportCode.toUpperCase();
  const cacheKey = `fr24:schedule:${code}:${dateStr}`;

  const cached = cacheGet<FR24ScheduleResult>(cacheKey);
  if (cached) {
    console.log(`[FR24-Schedule] Cache hit for ${code} on ${dateStr} — ${cached.flights.length} flights`);
    return cached;
  }

  // Convert date to 6:00 AM ET unix timestamp
  const dateObj = new Date(`${dateStr}T06:00:00-05:00`);
  const timestamp = Math.floor(dateObj.getTime() / 1000);

  console.log(`[FR24-Schedule] Fetching departures from ${code} for ${dateStr} (ts=${timestamp})...`);

  const allFlights: FR24ScheduleFlight[] = [];

  // Fetch first page to get totals
  let firstPage = await fetchSchedulePage(code, timestamp, 1);

  // FR24 Schedule API rejects dates >3 days out (HTTP 400).
  // Fall back to today's real schedule — most routes operate daily,
  // so today's departures are a reliable proxy for the requested date.
  let effectiveTimestamp = timestamp;
  if (!firstPage) {
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    if (todayStr !== dateStr) {
      const todayObj = new Date(`${todayStr}T06:00:00-05:00`);
      effectiveTimestamp = Math.floor(todayObj.getTime() / 1000);
      console.log(`[FR24-Schedule] Future date ${dateStr} rejected — falling back to today (${todayStr}, ts=${effectiveTimestamp})`);
      firstPage = await fetchSchedulePage(code, effectiveTimestamp, 1);
    }
  }

  if (!firstPage) {
    return { flights: [], totalFlights: 0, error: 'FR24 Schedule API unavailable' };
  }

  const totalPages = Math.min(firstPage.totalPages, FR24_MAX_PAGES);
  const totalItems = firstPage.totalItems;

  for (const raw of firstPage.data) {
    const parsed = parseScheduleFlight(raw);
    if (parsed) allFlights.push(parsed);
  }

  console.log(
    `[FR24-Schedule] Page 1/${totalPages}: ${firstPage.data.length} raw, ` +
    `${allFlights.length} parsed (${totalItems} total departures)`,
  );

  // Fetch remaining pages
  for (let page = 2; page <= totalPages; page++) {
    const pageResult = await fetchSchedulePage(code, effectiveTimestamp, page);
    if (!pageResult) break;

    let pageParsed = 0;
    for (const raw of pageResult.data) {
      const parsed = parseScheduleFlight(raw);
      if (parsed) {
        allFlights.push(parsed);
        pageParsed++;
      }
    }
    console.log(`[FR24-Schedule] Page ${page}/${totalPages}: ${pageResult.data.length} raw, ${pageParsed} parsed`);
  }

  console.log(`[FR24-Schedule] Total: ${allFlights.length} parseable flights from ${code}`);

  const result: FR24ScheduleResult = {
    flights: allFlights,
    totalFlights: totalItems,
    error: null,
  };

  cacheSet(cacheKey, result, FR24_SCHEDULE_CACHE_TTL);
  return result;
}

// =============================================================================
// Schedule API — Filter for a specific route (origin→dest on date)
// =============================================================================

export async function getFR24ScheduleForRoute(
  origin: string,
  dest: string,
  dateStr: string,
): Promise<{ flights: FR24ScheduleFlight[]; totalDepartures: number; error: string | null }> {
  const destUpper = dest.toUpperCase();
  const schedule = await getFR24ScheduleDepartures(origin, dateStr);

  if (schedule.error) {
    return { flights: [], totalDepartures: 0, error: schedule.error };
  }

  const routeFlights = schedule.flights.filter(f => f.destination === destUpper);
  console.log(
    `[FR24-Schedule] ${origin.toUpperCase()}→${destUpper}: ` +
    `${routeFlights.length} scheduled flights (from ${schedule.flights.length} total departures)`,
  );

  return {
    flights: routeFlights,
    totalDepartures: schedule.totalFlights,
    error: null,
  };
}

// =============================================================================
// Live Feed — Flights currently in the air
// =============================================================================

const FR24_FEED_URL =
  'https://data-cloud.flightradar24.com/zones/fcgi/feed.js' +
  '?faa=1&satellite=1&mlat=1&adsb=1&gnd=0&air=1&vehicles=0&estimated=1&maxage=14400&gliders=0&stats=0';
const FR24_FEED_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const FR24_FEED_CACHE_KEY = 'fr24:global_feed';

export type FR24LiveFlight = {
  icao24: string;
  latitude: number;
  longitude: number;
  origin: string;
  destination: string;
  callsign: string;
  altitude: number;
  speed: number;
  heading: number;
  squawk: string;
  registration: string;
  aircraft: string;
  fr24Id: string;
};

type FR24FeedResult = {
  flights: FR24LiveFlight[];
  fetchedAt: number;
  error: string | null;
};

async function fetchGlobalFeed(): Promise<FR24FeedResult> {
  const cached = cacheGet<FR24FeedResult>(FR24_FEED_CACHE_KEY);
  if (cached) {
    console.log(
      `[FR24-Live] Cache hit — ${cached.flights.length} flights ` +
      `(fetched ${Math.round((Date.now() - cached.fetchedAt) / 1000)}s ago)`,
    );
    return cached;
  }

  try {
    console.log('[FR24-Live] Fetching global flight feed...');
    const res = await fetch(FR24_FEED_URL, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; BumpHunter/1.0)',
      },
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) {
      console.warn(`[FR24-Live] Feed fetch failed: ${res.status}`);
      return { flights: [], fetchedAt: Date.now(), error: `FR24 HTTP ${res.status}` };
    }

    const raw = await res.json();
    const flights: FR24LiveFlight[] = [];

    for (const [key, val] of Object.entries(raw)) {
      if (!Array.isArray(val)) continue;
      if (val.length < 17) continue;

      const arr = val as any[];
      const origin = String(arr[11] || '').trim().toUpperCase();
      const dest = String(arr[12] || '').trim().toUpperCase();
      const callsign = String(arr[16] || '').trim().toUpperCase();

      if (!callsign || !origin || !dest) continue;

      flights.push({
        icao24: String(arr[0] || ''),
        latitude: Number(arr[1]) || 0,
        longitude: Number(arr[2]) || 0,
        origin,
        destination: dest,
        callsign,
        altitude: Number(arr[4]) || 0,
        speed: Number(arr[5]) || 0,
        heading: Number(arr[3]) || 0,
        squawk: String(arr[6] || ''),
        registration: String(arr[9] || ''),
        aircraft: String(arr[8] || '').toUpperCase(),
        fr24Id: key,
      });
    }

    console.log(`[FR24-Live] Got ${flights.length} flights currently in the air`);

    const result: FR24FeedResult = { flights, fetchedAt: Date.now(), error: null };
    cacheSet(FR24_FEED_CACHE_KEY, result, FR24_FEED_CACHE_TTL);
    return result;
  } catch (err) {
    console.warn('[FR24-Live] Feed fetch error:', err);
    return { flights: [], fetchedAt: Date.now(), error: String(err) };
  }
}

/**
 * Get flights currently in the air for a route (from live feed).
 */
export async function getFR24LiveFlightsForRoute(
  origin: string,
  dest: string,
): Promise<{ flights: FR24LiveFlight[]; error: string | null }> {
  const originUpper = origin.toUpperCase();
  const destUpper = dest.toUpperCase();

  const feed = await fetchGlobalFeed();
  if (feed.error && feed.flights.length === 0) {
    return { flights: [], error: feed.error };
  }

  const routeFlights = feed.flights.filter(
    f => f.origin === originUpper && f.destination === destUpper,
  );

  console.log(`[FR24-Live] ${originUpper}→${destUpper}: ${routeFlights.length} in air`);
  return { flights: routeFlights, error: null };
}

// =============================================================================
// Aircraft type code → scoring key mapping
// =============================================================================

export const FR24_AIRCRAFT_MAP: Record<string, string> = {
  'B738': 'B737', 'B739': 'B737', 'B737': 'B737',
  'B38M': 'B737MAX', 'B39M': 'B737MAX',
  'A320': 'A320', 'A20N': 'A320',
  'A321': 'A321', 'A21N': 'A321neo',
  'B752': 'B757', 'B753': 'B757',
  'B763': 'B767', 'B764': 'B767',
  'CRJ9': 'CRJ900', 'CR9': 'CRJ900',
  'E75S': 'E175', 'E75L': 'E175', 'E170': 'E175', 'E175': 'E175',
  'E190': 'E190', 'E195': 'E190',
  'A319': 'A319', 'A19N': 'A319',
};
