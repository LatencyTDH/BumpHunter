// =============================================================================
// OpenSky Network API Client
// https://openskynetwork.github.io/opensky-api/
//
// FREE tier (no API key): ~100 requests/day, 5s between requests
// We cache aggressively to stay within limits.
// =============================================================================

import { cacheGet, cacheSet } from './cache.js';
import { AIRPORT_ICAO } from './data.js';

const OPENSKY_BASE = 'https://opensky-network.org/api';
const DEPARTURE_CACHE_TTL = 60 * 60 * 1000; // 1 hour
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

export type ParsedFlight = {
  callsign: string;         // Raw callsign e.g. "DAL1432"
  carrierCode: string;      // IATA code e.g. "DL"
  carrierName: string;      // Full name e.g. "Delta"
  flightNumber: string;     // Display format e.g. "DL 1432"
  icao24: string;           // Aircraft hex address
  departureTime: number;    // Unix timestamp
  departureTimeStr: string; // HH:MM format
  arrivalAirport: string | null; // ICAO code if available
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
  // Regional operators (operate as mainline carriers)
  'SKW': { iata: 'OO', name: 'SkyWest' },     // Operates as DL/UA/AA/AS Connection
  'EDV': { iata: 'EV', name: 'Endeavor Air' }, // Operates as Delta Connection
  'RPA': { iata: 'YX', name: 'Republic' },     // Operates as DL/AA/UA
  'ENY': { iata: 'MQ', name: 'Envoy Air' },    // Operates as American Eagle
  'PSA': { iata: 'OH', name: 'PSA Airlines' }, // Operates as American Eagle
  'CPZ': { iata: 'C5', name: 'CommuteAir' },   // Operates as United Express
  'GJS': { iata: 'G7', name: 'GoJet' },        // Operates as Delta/United Connection
  'AAY': { iata: 'G4', name: 'Allegiant' },
  'SCX': { iata: 'XP', name: 'Sun Country' },
  'HAL': { iata: 'HA', name: 'Hawaiian' },
  'FDX': { iata: 'FX', name: 'FedEx' },        // Cargo - will filter out
  'UPS': { iata: '5X', name: 'UPS' },           // Cargo - will filter out
};

// Regional operators that brand under mainline carriers
const REGIONAL_BRANDING: Record<string, string> = {
  'EDV': 'DL', // Endeavor Air → Delta Connection
  'RPA': 'DL', // Republic → Delta Connection (primarily)
  'SKW': 'DL', // SkyWest → varies (DL/UA/AA/AS) but primarily DL at ATL
  'ENY': 'AA', // Envoy Air → American Eagle
  'PSA': 'AA', // PSA Airlines → American Eagle
  'CPZ': 'UA', // CommuteAir → United Express
  'GJS': 'UA', // GoJet → United Express (primarily)
};

// Cargo/non-passenger prefixes to exclude
const CARGO_PREFIXES = new Set(['FDX', 'UPS', 'GTI', 'ABX', 'ATN', 'CLX', 'QTR']);

// IATA codes that have stats in our carrier database
const SCORED_CARRIERS = new Set(['DL', 'AA', 'UA', 'WN', 'B6', 'NK', 'F9', 'AS']);

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
  brandedAs: string; // The mainline carrier code if regional
} | null {
  const callsign = rawCallsign.trim();
  if (!callsign || callsign.length < 4) return null;

  // Extract letters prefix and numeric suffix
  const match = callsign.match(/^([A-Z]{2,4})(\d+)$/);
  if (!match) return null;

  const [, prefix, num] = match;
  const mapping = CALLSIGN_MAP[prefix];
  if (!mapping) return null;

  // Skip cargo
  if (CARGO_PREFIXES.has(prefix)) return null;

  const isRegional = !!REGIONAL_BRANDING[prefix];
  const brandedAs = REGIONAL_BRANDING[prefix] || mapping.iata;

  return {
    icaoPrefix: prefix,
    flightNum: num,
    iataCode: mapping.iata,
    carrierName: mapping.name,
    isRegional,
    brandedAs,
  };
}

// =============================================================================
// Fetch departures from an airport
// =============================================================================

export async function fetchDepartures(
  airportIata: string,
  hoursBack: number = 12
): Promise<OpenSkyDeparture[]> {
  const icao = AIRPORT_ICAO[airportIata.toUpperCase()];
  if (!icao) {
    console.warn(`No ICAO code for airport: ${airportIata}`);
    return [];
  }

  const cacheKey = `opensky:departures:${icao}:${hoursBack}h`;
  const cached = cacheGet<OpenSkyDeparture[]>(cacheKey);
  if (cached) {
    console.log(`[OpenSky] Cache hit for departures from ${icao}`);
    return cached;
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const begin = now - (hoursBack * 3600);
    const url = `${OPENSKY_BASE}/flights/departure?airport=${icao}&begin=${begin}&end=${now}`;

    console.log(`[OpenSky] Fetching departures from ${icao} (last ${hoursBack}h)...`);
    const res = await rateLimitedFetch(url);

    if (!res.ok) {
      const text = await res.text();
      console.warn(`[OpenSky] Departures fetch failed: ${res.status} — ${text}`);
      return [];
    }

    const data = await res.json() as OpenSkyDeparture[];
    console.log(`[OpenSky] Got ${data.length} departures from ${icao}`);

    // Cache for 1 hour
    cacheSet(cacheKey, data, DEPARTURE_CACHE_TTL);
    return data;
  } catch (err) {
    console.warn(`[OpenSky] Departures fetch error:`, err);
    return [];
  }
}

// =============================================================================
// Fetch arrivals at an airport
// =============================================================================

export async function fetchArrivals(
  airportIata: string,
  hoursBack: number = 12
): Promise<OpenSkyDeparture[]> {
  const icao = AIRPORT_ICAO[airportIata.toUpperCase()];
  if (!icao) {
    console.warn(`No ICAO code for airport: ${airportIata}`);
    return [];
  }

  const cacheKey = `opensky:arrivals:${icao}:${hoursBack}h`;
  const cached = cacheGet<OpenSkyDeparture[]>(cacheKey);
  if (cached) {
    console.log(`[OpenSky] Cache hit for arrivals at ${icao}`);
    return cached;
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const begin = now - (hoursBack * 3600);
    const url = `${OPENSKY_BASE}/flights/arrival?airport=${icao}&begin=${begin}&end=${now}`;

    console.log(`[OpenSky] Fetching arrivals at ${icao} (last ${hoursBack}h)...`);
    const res = await rateLimitedFetch(url);

    if (!res.ok) {
      const text = await res.text();
      console.warn(`[OpenSky] Arrivals fetch failed: ${res.status} — ${text}`);
      return [];
    }

    const data = await res.json() as OpenSkyDeparture[];
    console.log(`[OpenSky] Got ${data.length} arrivals at ${icao}`);

    // Cache for 1 hour
    cacheSet(cacheKey, data, DEPARTURE_CACHE_TTL);
    return data;
  } catch (err) {
    console.warn(`[OpenSky] Arrivals fetch error:`, err);
    return [];
  }
}

// =============================================================================
// Get real flights for a route
//
// Strategy:
// 1. Fetch departures from origin → real callsigns & departure times
// 2. Fetch arrivals at destination → cross-reference by icao24
// 3. Confirmed matches = flights on this exact route
// 4. For unmatched departures from known carriers on this route, include
//    them as "likely" (OpenSky arrival data is often sparse for free tier)
// 5. Fall back to carrier presence detection: if we see Delta departures
//    from ATL, and Delta serves ATL→LGA, include those flights
// =============================================================================

export type RealFlight = {
  callsign: string;
  carrierCode: string;      // IATA: DL, AA, UA, etc.
  carrierName: string;
  flightNumber: string;     // "DL 1432"
  icao24: string;
  departureTime: string;    // HH:MM
  departureTimestamp: number;
  confirmed: boolean;       // true if cross-referenced via arrivals
  isRegional: boolean;
};

export async function getFlightsForRoute(
  origin: string,
  dest: string,
  _dateStr: string
): Promise<RealFlight[]> {
  const originUpper = origin.toUpperCase();
  const destUpper = dest.toUpperCase();
  const originIcao = AIRPORT_ICAO[originUpper];
  const destIcao = AIRPORT_ICAO[destUpper];

  if (!originIcao || !destIcao) {
    console.warn(`[OpenSky] Unknown airport: ${originUpper} or ${destUpper}`);
    return [];
  }

  // Check combined cache first
  const routeCacheKey = `opensky:route:${originUpper}:${destUpper}`;
  const cachedRoute = cacheGet<RealFlight[]>(routeCacheKey);
  if (cachedRoute) {
    console.log(`[OpenSky] Cache hit for route ${originUpper}→${destUpper}`);
    return cachedRoute;
  }

  // Fetch departures from origin and arrivals at destination in parallel
  const [departures, arrivals] = await Promise.all([
    fetchDepartures(originUpper, 12),
    fetchArrivals(destUpper, 12),
  ]);

  // Build set of icao24 addresses that arrived at destination
  const arrivedIcao24s = new Set<string>();
  const arrivalDepartureAirports = new Map<string, string>(); // icao24 → departure airport
  for (const arr of arrivals) {
    arrivedIcao24s.add(arr.icao24);
    if (arr.estDepartureAirport) {
      arrivalDepartureAirports.set(arr.icao24, arr.estDepartureAirport);
    }
  }

  // Process departures
  const flights: RealFlight[] = [];
  const seenCallsigns = new Set<string>();

  for (const dep of departures) {
    const rawCs = (dep.callsign || '').trim();
    if (!rawCs || seenCallsigns.has(rawCs)) continue;

    const parsed = parseCallsign(rawCs);
    if (!parsed) continue;

    // Get the display carrier (branded mainline code)
    const displayCarrier = parsed.brandedAs;
    if (!SCORED_CARRIERS.has(displayCarrier)) continue; // Only include carriers we can score

    // Check if this flight confirmed arrived at destination
    const confirmed = arrivedIcao24s.has(dep.icao24) &&
      arrivalDepartureAirports.get(dep.icao24) === originIcao;

    // Calculate departure time in local time (approximate)
    const depDate = new Date(dep.firstSeen * 1000);
    const depTimeStr = depDate.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'America/New_York', // Approximate - most US hubs are eastern/central
    });

    seenCallsigns.add(rawCs);

    flights.push({
      callsign: rawCs,
      carrierCode: displayCarrier,
      carrierName: parsed.isRegional
        ? `${CALLSIGN_MAP[parsed.icaoPrefix]?.name || parsed.carrierName} (${getCarrierFullName(displayCarrier)})`
        : getCarrierFullName(displayCarrier),
      flightNumber: `${displayCarrier} ${parsed.flightNum}`,
      icao24: dep.icao24,
      departureTime: depTimeStr,
      departureTimestamp: dep.firstSeen,
      confirmed,
      isRegional: parsed.isRegional,
    });
  }

  // Sort by departure time
  flights.sort((a, b) => a.departureTimestamp - b.departureTimestamp);

  // Cache for 1 hour
  cacheSet(routeCacheKey, flights, DEPARTURE_CACHE_TTL);
  return flights;
}

function getCarrierFullName(iataCode: string): string {
  const names: Record<string, string> = {
    'DL': 'Delta',
    'AA': 'American',
    'UA': 'United',
    'WN': 'Southwest',
    'B6': 'JetBlue',
    'NK': 'Spirit',
    'F9': 'Frontier',
    'AS': 'Alaska',
  };
  return names[iataCode] || iataCode;
}

// =============================================================================
// Get all commercial departures from an airport (for showing real activity)
// =============================================================================

export async function getAirportDepartures(
  airport: string
): Promise<RealFlight[]> {
  const departures = await fetchDepartures(airport.toUpperCase(), 12);

  const flights: RealFlight[] = [];
  const seenCallsigns = new Set<string>();

  for (const dep of departures) {
    const rawCs = (dep.callsign || '').trim();
    if (!rawCs || seenCallsigns.has(rawCs)) continue;

    const parsed = parseCallsign(rawCs);
    if (!parsed) continue;

    const displayCarrier = parsed.brandedAs;
    if (!SCORED_CARRIERS.has(displayCarrier)) continue;

    const depDate = new Date(dep.firstSeen * 1000);
    const depTimeStr = depDate.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'America/New_York',
    });

    seenCallsigns.add(rawCs);

    flights.push({
      callsign: rawCs,
      carrierCode: displayCarrier,
      carrierName: parsed.isRegional
        ? `${CALLSIGN_MAP[parsed.icaoPrefix]?.name || parsed.carrierName} (${getCarrierFullName(displayCarrier)})`
        : getCarrierFullName(displayCarrier),
      flightNumber: `${displayCarrier} ${parsed.flightNum}`,
      icao24: dep.icao24,
      departureTime: depTimeStr,
      departureTimestamp: dep.firstSeen,
      confirmed: false,
      isRegional: parsed.isRegional,
    });
  }

  flights.sort((a, b) => a.departureTimestamp - b.departureTimestamp);
  return flights;
}
