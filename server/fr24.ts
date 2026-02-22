// =============================================================================
// FlightRadar24 Public Feed Client
//
// FR24 exposes a public JSON feed of all flights currently in the air (~16k).
// No API key required. No rate limit issues.
// Returns real flights with actual origin/destination airports (IATA codes).
//
// We cache the full feed for 5 minutes and filter locally for any route.
// =============================================================================

import { cacheGet, cacheSet } from './cache.js';

const FR24_FEED_URL = 'https://data-cloud.flightradar24.com/zones/fcgi/feed.js?faa=1&satellite=1&mlat=1&adsb=1&gnd=0&air=1&vehicles=0&estimated=1&maxage=14400&gliders=0&stats=0';
const FR24_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const FR24_CACHE_KEY = 'fr24:global_feed';

// =============================================================================
// Types
// =============================================================================

export type FR24Flight = {
  icao24: string;       // ICAO hex address
  latitude: number;
  longitude: number;
  origin: string;       // IATA airport code (e.g. "ATL")
  destination: string;  // IATA airport code (e.g. "LGA")
  callsign: string;     // e.g. "DAL416"
  altitude: number;
  speed: number;
  heading: number;
  squawk: string;
  registration: string;
  aircraft: string;     // Aircraft type code (e.g. "B738")
  fr24Id: string;       // FR24's internal flight ID
};

export type FR24FeedResult = {
  flights: FR24Flight[];
  fetchedAt: number;
  error: string | null;
};

export type FR24RouteResult = {
  flights: FR24Flight[];
  error: string | null;
  totalInAir: number;   // Total flights in the global feed
};

// =============================================================================
// Fetch the global FR24 feed (cached for 5 min)
// =============================================================================

async function fetchGlobalFeed(): Promise<FR24FeedResult> {
  // Check cache first
  const cached = cacheGet<FR24FeedResult>(FR24_CACHE_KEY);
  if (cached) {
    console.log(`[FR24] Cache hit — ${cached.flights.length} flights (fetched ${Math.round((Date.now() - cached.fetchedAt) / 1000)}s ago)`);
    return cached;
  }

  try {
    console.log('[FR24] Fetching global flight feed...');
    const res = await fetch(FR24_FEED_URL, {
      headers: {
        'Accept': 'application/json',
        // FR24 sometimes checks user-agent
        'User-Agent': 'Mozilla/5.0 (compatible; BumpHunter/1.0)',
      },
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) {
      const text = await res.text();
      console.warn(`[FR24] Feed fetch failed: ${res.status} — ${text.slice(0, 200)}`);
      return { flights: [], fetchedAt: Date.now(), error: `FR24 HTTP ${res.status}` };
    }

    const raw = await res.json();

    // The FR24 feed returns an object where:
    // - Some keys are metadata (full_count, version, etc.)
    // - Flight entries are keyed by FR24 internal ID, each value is an array
    const flights: FR24Flight[] = [];

    for (const [key, val] of Object.entries(raw)) {
      // Skip metadata keys
      if (!Array.isArray(val)) continue;
      if (val.length < 17) continue;

      const arr = val as any[];
      const origin = String(arr[11] || '').trim().toUpperCase();
      const dest = String(arr[12] || '').trim().toUpperCase();
      const callsign = String(arr[16] || '').trim().toUpperCase();

      // Skip entries without meaningful data
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

    console.log(`[FR24] Got ${flights.length} flights currently in the air`);

    const result: FR24FeedResult = {
      flights,
      fetchedAt: Date.now(),
      error: null,
    };

    // Cache for 5 minutes
    cacheSet(FR24_CACHE_KEY, result, FR24_CACHE_TTL);
    return result;
  } catch (err) {
    console.warn('[FR24] Feed fetch error:', err);
    return { flights: [], fetchedAt: Date.now(), error: String(err) };
  }
}

// =============================================================================
// Get flights for a specific route from the FR24 feed
// Filters the global feed locally — very fast after first fetch.
// =============================================================================

export async function getFR24FlightsForRoute(
  origin: string,
  dest: string
): Promise<FR24RouteResult> {
  const originUpper = origin.toUpperCase();
  const destUpper = dest.toUpperCase();

  const feed = await fetchGlobalFeed();

  if (feed.error && feed.flights.length === 0) {
    return { flights: [], error: feed.error, totalInAir: 0 };
  }

  // Filter for this route
  const routeFlights = feed.flights.filter(
    f => f.origin === originUpper && f.destination === destUpper
  );

  console.log(`[FR24] ${originUpper}→${destUpper}: ${routeFlights.length} flights currently in the air (from ${feed.flights.length} total)`);

  return {
    flights: routeFlights,
    error: null,
    totalInAir: feed.flights.length,
  };
}

// =============================================================================
// FR24 aircraft type code → our aircraft type key mapping
// =============================================================================

export const FR24_AIRCRAFT_MAP: Record<string, string> = {
  'B738': 'B737',
  'B739': 'B737',
  'B737': 'B737',
  'B38M': 'B737MAX',
  'B39M': 'B737MAX',
  'A320': 'A320',
  'A20N': 'A320',
  'A321': 'A321',
  'A21N': 'A321neo',
  'B752': 'B757',
  'B753': 'B757',
  'B763': 'B767',
  'B764': 'B767',
  'CRJ9': 'CRJ900',
  'CR9': 'CRJ900',
  'E75S': 'E175',
  'E75L': 'E175',
  'E170': 'E175',
  'E175': 'E175',
  'E190': 'E190',
  'E195': 'E190',
  'A319': 'A319',
  'A19N': 'A319',
};
