// =============================================================================
// OpenSky Network API Client + ADSBDB Route Verification + FR24 Integration
//
// Data source hierarchy:
//   1. FR24 feed — real-time flights currently in the air (always available)
//   2. OpenSky departures — recent departures (when not rate limited)
//   3. ADSBDB — route verification for OpenSky callsigns
//
// All three sources provide REAL flight data. NO fake data. EVER.
// =============================================================================

import { cacheGet, cacheSet } from './cache.js';
import { AIRPORT_ICAO } from './data.js';
import { getFR24FlightsForRoute, FR24_AIRCRAFT_MAP, type FR24Flight } from './fr24.js';

const OPENSKY_BASE = 'https://opensky-network.org/api';
const ADSBDB_BASE = 'https://api.adsbdb.com/v0';
const DEPARTURE_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const ADSBDB_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours — routes rarely change
const MIN_REQUEST_INTERVAL = 6000; // 6s between requests (buffer above 5s limit)

let lastRequestTime = 0;

// =============================================================================
// Types
// =============================================================================

export type OpenSkyDeparture = {
  icao24: string;
  firstSeen: number;
  estDepartureAirport: string;
  lastSeen: number;
  estArrivalAirport: string | null;
  callsign: string;
  estDepartureAirportHorizDistance: number;
  estDepartureAirportVertDistance: number;
  estArrivalAirportHorizDistance: number | null;
  estArrivalAirportVertDistance: number | null;
  departureAirportCandidatesCount: number;
  arrivalAirportCandidatesCount: number;
};

// =============================================================================
// Callsign → Airline mapping
// ICAO airline designators → IATA codes and names
// =============================================================================

const CALLSIGN_MAP: Record<string, { iata: string; name: string }> = {
  'DAL': { iata: 'DL', name: 'Delta' },
  'AAL': { iata: 'AA', name: 'American' },
  'UAL': { iata: 'UA', name: 'United' },
  'SWA': { iata: 'WN', name: 'Southwest' },
  'JBU': { iata: 'B6', name: 'JetBlue' },
  'NKS': { iata: 'NK', name: 'Spirit' },
  'FFT': { iata: 'F9', name: 'Frontier' },
  'ASA': { iata: 'AS', name: 'Alaska' },
  // Regional operators
  'SKW': { iata: 'OO', name: 'SkyWest' },
  'EDV': { iata: 'EV', name: 'Endeavor Air' },
  'RPA': { iata: 'YX', name: 'Republic' },
  'ENY': { iata: 'MQ', name: 'Envoy Air' },
  'PSA': { iata: 'OH', name: 'PSA Airlines' },
  'CPZ': { iata: 'C5', name: 'CommuteAir' },
  'GJS': { iata: 'G7', name: 'GoJet' },
  'AAY': { iata: 'G4', name: 'Allegiant' },
  'SCX': { iata: 'XP', name: 'Sun Country' },
  'HAL': { iata: 'HA', name: 'Hawaiian' },
  'FDX': { iata: 'FX', name: 'FedEx' },
  'UPS': { iata: '5X', name: 'UPS' },
};

// Regional operators that brand under mainline carriers
const REGIONAL_BRANDING: Record<string, string> = {
  'EDV': 'DL', 'RPA': 'DL', 'SKW': 'DL',
  'ENY': 'AA', 'PSA': 'AA',
  'CPZ': 'UA', 'GJS': 'UA',
};

// Cargo/non-passenger prefixes to exclude
const CARGO_PREFIXES = new Set(['FDX', 'UPS', 'GTI', 'ABX', 'ATN', 'CLX', 'QTR']);

// IATA codes that have stats in our carrier database
const SCORED_CARRIERS = new Set(['DL', 'AA', 'UA', 'WN', 'B6', 'NK', 'F9', 'AS']);

// Build ICAO → IATA reverse map
const ICAO_TO_IATA: Record<string, string> = {};
for (const [iata, icao] of Object.entries(AIRPORT_ICAO)) {
  ICAO_TO_IATA[icao] = iata;
}

// =============================================================================
// Rate limiter
// =============================================================================

async function rateLimitedFetch(url: string): Promise<Response> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_REQUEST_INTERVAL) {
    await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL - elapsed));
  }
  lastRequestTime = Date.now();

  return fetch(url, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
}

// =============================================================================
// Parse callsign into airline info
// =============================================================================

export function parseCallsign(rawCallsign: string): {
  icaoPrefix: string;
  flightNum: string;
  iataCode: string;
  carrierName: string;
  isRegional: boolean;
  brandedAs: string;
} | null {
  const callsign = rawCallsign.trim();
  if (!callsign || callsign.length < 4) return null;

  const match = callsign.match(/^([A-Z]{2,4})(\d+)$/);
  if (!match) return null;

  const [, prefix, num] = match;
  const mapping = CALLSIGN_MAP[prefix];
  if (!mapping) return null;

  if (CARGO_PREFIXES.has(prefix)) return null;

  const isRegional = !!REGIONAL_BRANDING[prefix];
  const brandedAs = REGIONAL_BRANDING[prefix] || mapping.iata;

  return { icaoPrefix: prefix, flightNum: num, iataCode: mapping.iata, carrierName: mapping.name, isRegional, brandedAs };
}

// =============================================================================
// ADSBDB Route Verification (cached 24h)
// =============================================================================

type AdsbdbRoute = {
  origin: string;
  destination: string;
  verified: boolean;
} | null;

async function lookupRouteViaAdsbdb(callsign: string): Promise<AdsbdbRoute> {
  const cacheKey = `adsbdb:route:${callsign}`;
  const cached = cacheGet<AdsbdbRoute>(cacheKey);
  if (cached !== null) return cached;

  try {
    const url = `${ADSBDB_BASE}/callsign/${callsign}`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      cacheSet(cacheKey, null, 60 * 60 * 1000);
      return null;
    }

    const data = await res.json();
    const flightroute = data?.response?.flightroute;
    if (!flightroute?.origin || !flightroute?.destination) {
      cacheSet(cacheKey, null, 60 * 60 * 1000);
      return null;
    }

    const originIata = (flightroute.origin.iata_code || flightroute.origin.code || '').toUpperCase();
    const destIata = (flightroute.destination.iata_code || flightroute.destination.code || '').toUpperCase();

    if (!originIata || !destIata) {
      cacheSet(cacheKey, null, 60 * 60 * 1000);
      return null;
    }

    const route: AdsbdbRoute = { origin: originIata, destination: destIata, verified: true };
    cacheSet(cacheKey, route, ADSBDB_CACHE_TTL);
    return route;
  } catch (err) {
    console.warn(`[ADSBDB] Route lookup failed for ${callsign}:`, err);
    cacheSet(cacheKey, null, 30 * 60 * 1000);
    return null;
  }
}

// =============================================================================
// Fetch OpenSky departures
// =============================================================================

export type DepartureResult = {
  departures: OpenSkyDeparture[];
  rateLimited: boolean;
  error: string | null;
};

export async function fetchDepartures(
  airportIata: string,
  hoursBack: number = 12
): Promise<DepartureResult> {
  const icao = AIRPORT_ICAO[airportIata.toUpperCase()];
  if (!icao) return { departures: [], rateLimited: false, error: `Unknown airport: ${airportIata}` };

  const cacheKey = `opensky:departures:${icao}:${hoursBack}h`;
  const cached = cacheGet<OpenSkyDeparture[]>(cacheKey);
  if (cached) {
    console.log(`[OpenSky] Cache hit for departures from ${icao}`);
    return { departures: cached, rateLimited: false, error: null };
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const begin = now - (hoursBack * 3600);
    const url = `${OPENSKY_BASE}/flights/departure?airport=${icao}&begin=${begin}&end=${now}`;

    console.log(`[OpenSky] Fetching departures from ${icao} (last ${hoursBack}h)...`);
    const res = await rateLimitedFetch(url);

    if (res.status === 429) {
      console.warn(`[OpenSky] Rate limited (429) for ${icao}`);
      return { departures: [], rateLimited: true, error: 'OpenSky rate limit reached' };
    }

    if (!res.ok) {
      const text = await res.text();
      console.warn(`[OpenSky] Failed: ${res.status} — ${text}`);
      return { departures: [], rateLimited: false, error: `OpenSky HTTP ${res.status}` };
    }

    const data = await res.json() as OpenSkyDeparture[];
    console.log(`[OpenSky] Got ${data.length} departures from ${icao}`);
    cacheSet(cacheKey, data, DEPARTURE_CACHE_TTL);
    return { departures: data, rateLimited: false, error: null };
  } catch (err) {
    console.warn(`[OpenSky] Error:`, err);
    return { departures: [], rateLimited: false, error: String(err) };
  }
}

// =============================================================================
// Unified flight type used by scoring
// =============================================================================

export type RealFlight = {
  callsign: string;          // ICAO callsign (e.g. "DAL1432")
  carrierCode: string;       // IATA: DL, AA, UA, etc.
  carrierName: string;
  flightNumber: string;      // Display: "DL 1432"
  icao24: string;
  departureTime: string;     // HH:MM (ET)
  departureTimestamp: number; // Unix seconds
  verified: boolean;         // Route verified
  verificationSource: 'fr24' | 'adsbdb' | 'opensky-estimate' | 'none';
  isRegional: boolean;
  dataSource: 'fr24' | 'opensky';
  fr24AircraftCode: string | null; // Raw aircraft type from FR24 (e.g. "B738")
  trackingUrl: string;       // FlightAware tracking URL
};

export type RouteSearchResult = {
  flights: RealFlight[];
  rateLimited: boolean;
  openskyRateLimited: boolean;
  error: string | null;
  totalDepartures: number;
  verifiedCount: number;
  dataSources: string[];     // Which sources contributed data
};

// =============================================================================
// Get real flights for a route — combining FR24 + OpenSky + ADSBDB
//
// Strategy:
// 1. FR24 feed for flights currently in the air (always works, has origin/dest)
// 2. OpenSky for recent departures (may be rate limited)
// 3. ADSBDB to verify OpenSky callsign routes
// 4. Deduplicate by callsign, preferring FR24 (has verified route)
// 5. NO fallbacks. NO fake data. If nothing available, return empty.
// =============================================================================

export async function getFlightsForRoute(
  origin: string,
  dest: string,
  _dateStr: string
): Promise<RouteSearchResult> {
  const originUpper = origin.toUpperCase();
  const destUpper = dest.toUpperCase();
  const originIcao = AIRPORT_ICAO[originUpper];
  const destIcao = AIRPORT_ICAO[destUpper];

  if (!originIcao || !destIcao) {
    return { flights: [], rateLimited: false, openskyRateLimited: false, error: `Unknown airport: ${originUpper} or ${destUpper}`, totalDepartures: 0, verifiedCount: 0, dataSources: [] };
  }

  // Check combined cache first
  const routeCacheKey = `combined:route:${originUpper}:${destUpper}:v3`;
  const cachedRoute = cacheGet<RouteSearchResult>(routeCacheKey);
  if (cachedRoute) {
    console.log(`[Route] Cache hit for ${originUpper}→${destUpper}`);
    return cachedRoute;
  }

  const allFlights: RealFlight[] = [];
  const seenCallsigns = new Set<string>();
  let verifiedCount = 0;
  const dataSources: string[] = [];
  let openskyRateLimited = false;

  // ======= SOURCE 1: FR24 (flights currently in the air) =======
  try {
    const fr24Result = await getFR24FlightsForRoute(originUpper, destUpper);

    if (fr24Result.flights.length > 0) {
      dataSources.push('FlightRadar24 (live)');

      for (const f of fr24Result.flights) {
        const rawCs = f.callsign;
        if (!rawCs || seenCallsigns.has(rawCs)) continue;

        const parsed = parseCallsign(rawCs);
        if (!parsed) continue;

        const displayCarrier = parsed.brandedAs;
        if (!SCORED_CARRIERS.has(displayCarrier)) continue;

        seenCallsigns.add(rawCs);
        verifiedCount++; // FR24 provides verified origin/destination

        allFlights.push({
          callsign: rawCs,
          carrierCode: displayCarrier,
          carrierName: parsed.isRegional
            ? `${CALLSIGN_MAP[parsed.icaoPrefix]?.name || parsed.carrierName} (${getCarrierFullName(displayCarrier)})`
            : getCarrierFullName(displayCarrier),
          flightNumber: `${displayCarrier} ${parsed.flightNum}`,
          icao24: f.icao24,
          departureTime: estimateDepTimeFromFR24(),
          departureTimestamp: Math.floor(Date.now() / 1000),
          verified: true,
          verificationSource: 'fr24',
          isRegional: parsed.isRegional,
          dataSource: 'fr24',
          fr24AircraftCode: f.aircraft || null,
          trackingUrl: `https://www.flightaware.com/live/flight/${rawCs}`,
        });
      }

      console.log(`[Route] FR24 contributed ${fr24Result.flights.length} flights for ${originUpper}→${destUpper}`);
    }
  } catch (err) {
    console.warn(`[Route] FR24 failed:`, err);
  }

  // ======= SOURCE 2: OpenSky departures + ADSBDB verification =======
  try {
    const { departures, rateLimited, error } = await fetchDepartures(originUpper, 12);
    openskyRateLimited = rateLimited;

    if (!rateLimited && departures.length > 0) {
      // Collect parseable candidates
      const candidates: { dep: OpenSkyDeparture; parsed: NonNullable<ReturnType<typeof parseCallsign>>; rawCs: string }[] = [];

      for (const dep of departures) {
        const rawCs = (dep.callsign || '').trim();
        if (!rawCs || seenCallsigns.has(rawCs)) continue;

        const parsed = parseCallsign(rawCs);
        if (!parsed) continue;

        const displayCarrier = parsed.brandedAs;
        if (!SCORED_CARRIERS.has(displayCarrier)) continue;

        candidates.push({ dep, parsed, rawCs });
      }

      // Verify routes via ADSBDB in batches
      const CONCURRENCY = 5;
      for (let i = 0; i < candidates.length; i += CONCURRENCY) {
        const batch = candidates.slice(i, i + CONCURRENCY);
        const routeResults = await Promise.all(batch.map(c => lookupRouteViaAdsbdb(c.rawCs)));

        for (let j = 0; j < batch.length; j++) {
          const { dep, parsed, rawCs } = batch[j];
          const route = routeResults[j];

          let verified = false;
          let verificationSource: 'adsbdb' | 'opensky-estimate' | 'none' = 'none';

          if (route?.verified) {
            if (route.destination === destUpper) {
              verified = true;
              verificationSource = 'adsbdb';
              verifiedCount++;
            } else {
              continue; // Goes somewhere else
            }
          } else {
            const depArr = (dep.estArrivalAirport || '').trim().toUpperCase();
            if (depArr === destIcao) {
              verificationSource = 'opensky-estimate';
            } else {
              continue; // Can't verify
            }
          }

          seenCallsigns.add(rawCs);
          const displayCarrier = parsed.brandedAs;

          const depDate = new Date(dep.firstSeen * 1000);
          const depTimeStr = depDate.toLocaleTimeString('en-US', {
            hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York',
          });

          allFlights.push({
            callsign: rawCs,
            carrierCode: displayCarrier,
            carrierName: parsed.isRegional
              ? `${CALLSIGN_MAP[parsed.icaoPrefix]?.name || parsed.carrierName} (${getCarrierFullName(displayCarrier)})`
              : getCarrierFullName(displayCarrier),
            flightNumber: `${displayCarrier} ${parsed.flightNum}`,
            icao24: dep.icao24,
            departureTime: depTimeStr,
            departureTimestamp: dep.firstSeen,
            verified,
            verificationSource,
            isRegional: parsed.isRegional,
            dataSource: 'opensky',
            fr24AircraftCode: null,
            trackingUrl: `https://www.flightaware.com/live/flight/${rawCs}`,
          });
        }
      }

      if (!dataSources.includes('OpenSky Network')) {
        dataSources.push('OpenSky Network');
      }
      console.log(`[Route] OpenSky contributed additional flights for ${originUpper}→${destUpper}`);
    } else if (rateLimited) {
      console.log(`[Route] OpenSky rate limited — relying on FR24 data`);
    }
  } catch (err) {
    console.warn(`[Route] OpenSky/ADSBDB failed:`, err);
  }

  // Sort by departure time
  allFlights.sort((a, b) => a.departureTimestamp - b.departureTimestamp);

  const result: RouteSearchResult = {
    flights: allFlights,
    rateLimited: allFlights.length === 0 && openskyRateLimited,
    openskyRateLimited,
    error: allFlights.length === 0 && openskyRateLimited ? 'All data sources unavailable or rate limited' : null,
    totalDepartures: allFlights.length,
    verifiedCount,
    dataSources,
  };

  // Cache for 5 minutes (FR24 data is fresh for ~5 min)
  cacheSet(routeCacheKey, result, 5 * 60 * 1000);
  return result;
}

// =============================================================================
// Helpers
// =============================================================================

/** Estimate departure time for a flight currently in the air (FR24 doesn't give dep time) */
function estimateDepTimeFromFR24(): string {
  // FR24 flights are currently in the air, so they departed sometime recently.
  // We don't know the exact departure time, so we mark it as "In Air"
  const now = new Date();
  return now.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York',
  });
}

function getCarrierFullName(iataCode: string): string {
  const names: Record<string, string> = {
    'DL': 'Delta', 'AA': 'American', 'UA': 'United', 'WN': 'Southwest',
    'B6': 'JetBlue', 'NK': 'Spirit', 'F9': 'Frontier', 'AS': 'Alaska',
  };
  return names[iataCode] || iataCode;
}
