// =============================================================================
// Flight Data Aggregator — FR24 Schedule + Live Feed + OpenSky + ADSBDB
//
// Data source hierarchy:
//   1. FR24 Airport Schedule API — SCHEDULED departures (primary, works 24/7)
//   2. FR24 Live Feed — flights currently airborne (supplements with "In Air")
//   3. OpenSky departures — tertiary fallback (when not rate limited)
//   4. ADSBDB — route verification for OpenSky callsigns
//
// All sources provide REAL flight data. NO fake data. EVER.
// =============================================================================

import { cacheGet, cacheSet } from './cache.js';
import { AIRPORT_ICAO } from './data.js';
import {
  getFR24ScheduleForRoute,
  getFR24LiveFlightsForRoute,
  FR24_AIRCRAFT_MAP,
  type FR24ScheduleFlight,
  type FR24LiveFlight,
} from './fr24.js';

const OPENSKY_BASE = 'https://opensky-network.org/api';
const ADSBDB_BASE = 'https://api.adsbdb.com/v0';
const DEPARTURE_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const ADSBDB_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const MIN_REQUEST_INTERVAL = 6000; // 6s between OpenSky requests

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
// Callsign → Airline mapping (ICAO designators)
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

const REGIONAL_BRANDING: Record<string, string> = {
  'EDV': 'DL', 'RPA': 'DL', 'SKW': 'DL',
  'ENY': 'AA', 'PSA': 'AA',
  'CPZ': 'UA', 'GJS': 'UA',
};

const CARGO_PREFIXES = new Set(['FDX', 'UPS', 'GTI', 'ABX', 'ATN', 'CLX', 'QTR']);
const SCORED_CARRIERS = new Set(['DL', 'AA', 'UA', 'WN', 'B6', 'NK', 'F9', 'AS']);

// ICAO ↔ IATA reverse map
const ICAO_TO_IATA: Record<string, string> = {};
for (const [iata, icao] of Object.entries(AIRPORT_ICAO)) {
  ICAO_TO_IATA[icao] = iata;
}

// =============================================================================
// Rate limiter (for OpenSky)
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
// Parse ICAO callsign into airline info
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

type AdsbdbRoute = { origin: string; destination: string; verified: boolean } | null;

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

    if (!res.ok) { cacheSet(cacheKey, null, 60 * 60 * 1000); return null; }

    const data = await res.json();
    const flightroute = data?.response?.flightroute;
    if (!flightroute?.origin || !flightroute?.destination) { cacheSet(cacheKey, null, 60 * 60 * 1000); return null; }

    const originIata = (flightroute.origin.iata_code || flightroute.origin.code || '').toUpperCase();
    const destIata = (flightroute.destination.iata_code || flightroute.destination.code || '').toUpperCase();
    if (!originIata || !destIata) { cacheSet(cacheKey, null, 60 * 60 * 1000); return null; }

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
  hoursBack: number = 12,
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
  callsign: string;          // ICAO callsign (e.g. "DAL323")
  carrierCode: string;       // IATA branded carrier: DL, AA, UA, etc.
  carrierName: string;       // Display name (e.g. "Delta Air Lines")
  flightNumber: string;      // Display: "DL 323"
  icao24: string;
  departureTime: string;     // HH:MM (ET)
  departureTimestamp: number; // Unix seconds
  verified: boolean;
  verificationSource: 'fr24-schedule' | 'fr24-live' | 'adsbdb' | 'opensky-estimate' | 'none';
  isRegional: boolean;
  dataSource: 'fr24-schedule' | 'fr24-live' | 'opensky';
  fr24AircraftCode: string | null;
  trackingUrl: string;

  // Rich fields from FR24 Schedule API
  airline: string;            // "Delta Air Lines" (operator)
  operatingCarrierCode: string; // IATA code of the OPERATING carrier (e.g. "YX" for Republic Airways)
  aircraftName: string;       // "Airbus A321-211"
  registration: string;       // "N848DN"
  status: string;             // "Estimated dep 07:48" / "In Air"
  isLive: boolean;            // Currently airborne
  codeshares: string[];       // ["AF6825", "KE7079"]
};

export type RouteSearchResult = {
  flights: RealFlight[];
  rateLimited: boolean;
  openskyRateLimited: boolean;
  error: string | null;
  totalDepartures: number;
  verifiedCount: number;
  dataSources: string[];
};

// =============================================================================
// Extract branded IATA carrier code from a flight number like "DL323" or "AA4533"
// =============================================================================

function extractCarrierFromFlightNumber(fn: string): { iata: string; num: string } | null {
  const m = fn.match(/^([A-Z]{2})(\d+)$/);
  if (!m) return null;
  return { iata: m[1], num: m[2] };
}

// =============================================================================
// Main entry: get real flights for a route
//
// 1. FR24 Schedule API (PRIMARY) — scheduled departures, works 24/7
// 2. FR24 Live Feed (SUPPLEMENT) — overlay "In Air" on scheduled flights,
//    add any in-air flights not already in the schedule
// 3. OpenSky (TERTIARY) — only if we got 0 from FR24 schedule
// =============================================================================

export async function getFlightsForRoute(
  origin: string,
  dest: string,
  dateStr: string,
): Promise<RouteSearchResult> {
  const originUpper = origin.toUpperCase();
  const destUpper = dest.toUpperCase();
  const originIcao = AIRPORT_ICAO[originUpper];
  const destIcao = AIRPORT_ICAO[destUpper];

  if (!originIcao || !destIcao) {
    return {
      flights: [], rateLimited: false, openskyRateLimited: false,
      error: `Unknown airport: ${originUpper} or ${destUpper}`,
      totalDepartures: 0, verifiedCount: 0, dataSources: [],
    };
  }

  // Check combined cache
  const routeCacheKey = `combined:route:${originUpper}:${destUpper}:${dateStr}:v4`;
  const cachedRoute = cacheGet<RouteSearchResult>(routeCacheKey);
  if (cachedRoute) {
    console.log(`[Route] Cache hit for ${originUpper}→${destUpper} on ${dateStr}`);
    return cachedRoute;
  }

  const allFlights: RealFlight[] = [];
  const seenFlightNumbers = new Set<string>(); // Dedupe by flight number (e.g. "DL323")
  const seenCallsigns = new Set<string>();
  let verifiedCount = 0;
  const dataSources: string[] = [];
  let openskyRateLimited = false;

  // =========================================================================
  // SOURCE 1: FR24 Schedule API (PRIMARY)
  // =========================================================================
  try {
    const scheduleResult = await getFR24ScheduleForRoute(originUpper, destUpper, dateStr);

    if (scheduleResult.flights.length > 0) {
      dataSources.push('FlightRadar24 (schedule)');

      for (const sf of scheduleResult.flights) {
        // Extract branded carrier from flight number (e.g. "DL" from "DL323")
        const parsed = extractCarrierFromFlightNumber(sf.flightNumber);
        if (!parsed) continue;

        const { iata: brandedCarrier, num: flightNum } = parsed;

        // Only include carriers we can score
        if (!SCORED_CARRIERS.has(brandedCarrier)) continue;

        // Dedupe
        if (seenFlightNumbers.has(sf.flightNumber)) continue;
        seenFlightNumbers.add(sf.flightNumber);
        if (sf.callsign) seenCallsigns.add(sf.callsign.toUpperCase());

        // Is the operator different from the branded carrier? → regional
        const isRegional = sf.airlineIata !== '' && sf.airlineIata !== brandedCarrier;

        // Build carrier display name
        let carrierName: string;
        if (isRegional && sf.airline) {
          carrierName = `${sf.airline} (${getCarrierFullName(brandedCarrier)})`;
        } else {
          carrierName = sf.airline || getCarrierFullName(brandedCarrier);
        }

        // Build callsign for FlightAware URL
        const callsign = sf.callsign || sf.airlineIcao + flightNum || '';

        verifiedCount++; // Schedule API gives us verified origin/destination

        allFlights.push({
          callsign: callsign.toUpperCase(),
          carrierCode: brandedCarrier,
          carrierName,
          flightNumber: `${brandedCarrier} ${flightNum}`,
          icao24: '',
          departureTime: sf.depTime,
          departureTimestamp: sf.departureTimestamp,
          verified: true,
          verificationSource: 'fr24-schedule',
          isRegional,
          dataSource: 'fr24-schedule',
          fr24AircraftCode: sf.aircraftCode || null,
          trackingUrl: `https://www.flightaware.com/live/flight/${callsign || brandedCarrier + flightNum}`,
          airline: sf.airline,
          operatingCarrierCode: sf.airlineIata || brandedCarrier,
          aircraftName: sf.aircraftName,
          registration: sf.registration,
          status: sf.isLive ? 'In Air' : (sf.status || 'Scheduled'),
          isLive: sf.isLive,
          codeshares: sf.codeshares,
        });
      }

      console.log(`[Route] FR24 Schedule contributed ${allFlights.length} flights for ${originUpper}→${destUpper}`);
    }
  } catch (err) {
    console.warn(`[Route] FR24 Schedule failed:`, err);
  }

  // =========================================================================
  // SOURCE 2: FR24 Live Feed (SUPPLEMENT — overlay "In Air" status)
  // =========================================================================
  try {
    const liveResult = await getFR24LiveFlightsForRoute(originUpper, destUpper);

    if (liveResult.flights.length > 0) {
      for (const lf of liveResult.flights) {
        const rawCs = lf.callsign;
        if (!rawCs) continue;

        // If this callsign matches a scheduled flight, mark it as "In Air"
        const existingFlight = allFlights.find(
          f => f.callsign === rawCs || f.callsign === rawCs.toUpperCase(),
        );
        if (existingFlight) {
          existingFlight.status = 'In Air';
          existingFlight.isLive = true;
          existingFlight.icao24 = lf.icao24;
          // Update registration from live feed if schedule didn't have it
          if (!existingFlight.registration && lf.registration) {
            existingFlight.registration = lf.registration;
          }
          continue;
        }

        // Not in schedule — add as a new live-only flight
        if (seenCallsigns.has(rawCs)) continue;

        const parsedCs = parseCallsign(rawCs);
        if (!parsedCs) continue;

        const displayCarrier = parsedCs.brandedAs;
        if (!SCORED_CARRIERS.has(displayCarrier)) continue;

        seenCallsigns.add(rawCs);
        verifiedCount++;

        if (!dataSources.includes('FlightRadar24 (live)')) {
          dataSources.push('FlightRadar24 (live)');
        }

        allFlights.push({
          callsign: rawCs,
          carrierCode: displayCarrier,
          carrierName: parsedCs.isRegional
            ? `${CALLSIGN_MAP[parsedCs.icaoPrefix]?.name || parsedCs.carrierName} (${getCarrierFullName(displayCarrier)})`
            : getCarrierFullName(displayCarrier),
          flightNumber: `${displayCarrier} ${parsedCs.flightNum}`,
          icao24: lf.icao24,
          departureTime: new Date().toLocaleTimeString('en-US', {
            hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York',
          }),
          departureTimestamp: Math.floor(Date.now() / 1000),
          verified: true,
          verificationSource: 'fr24-live',
          isRegional: parsedCs.isRegional,
          dataSource: 'fr24-live',
          fr24AircraftCode: lf.aircraft || null,
          trackingUrl: `https://www.flightaware.com/live/flight/${rawCs}`,
          airline: getCarrierFullName(displayCarrier),
          operatingCarrierCode: parsedCs.isRegional ? (CALLSIGN_MAP[parsedCs.icaoPrefix]?.iata || displayCarrier) : displayCarrier,
          aircraftName: '',
          registration: lf.registration || '',
          status: 'In Air',
          isLive: true,
          codeshares: [],
        });
      }

      console.log(
        `[Route] FR24 Live overlay: ${liveResult.flights.length} airborne ` +
        `for ${originUpper}→${destUpper}`,
      );
    }
  } catch (err) {
    console.warn(`[Route] FR24 Live feed failed:`, err);
  }

  // =========================================================================
  // SOURCE 3: OpenSky (TERTIARY — only if schedule gave us 0 flights)
  // =========================================================================
  if (allFlights.length === 0) {
    try {
      const { departures, rateLimited, error } = await fetchDepartures(originUpper, 12);
      openskyRateLimited = rateLimited;

      if (!rateLimited && departures.length > 0) {
        const candidates: { dep: OpenSkyDeparture; parsed: NonNullable<ReturnType<typeof parseCallsign>>; rawCs: string }[] = [];

        for (const dep of departures) {
          const rawCs = (dep.callsign || '').trim();
          if (!rawCs || seenCallsigns.has(rawCs)) continue;

          const parsed = parseCallsign(rawCs);
          if (!parsed) continue;
          if (!SCORED_CARRIERS.has(parsed.brandedAs)) continue;

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
                continue;
              }
            } else {
              const depArr = (dep.estArrivalAirport || '').trim().toUpperCase();
              if (depArr === destIcao) {
                verificationSource = 'opensky-estimate';
              } else {
                continue;
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
              airline: getCarrierFullName(displayCarrier),
              operatingCarrierCode: parsed.isRegional ? (CALLSIGN_MAP[parsed.icaoPrefix]?.iata || displayCarrier) : displayCarrier,
              aircraftName: '',
              registration: '',
              status: 'Departed',
              isLive: false,
              codeshares: [],
            });
          }
        }

        if (allFlights.length > 0 && !dataSources.includes('OpenSky Network')) {
          dataSources.push('OpenSky Network');
        }
        console.log(`[Route] OpenSky contributed ${allFlights.length} flights for ${originUpper}→${destUpper}`);
      } else if (rateLimited) {
        console.log(`[Route] OpenSky rate limited`);
      }
    } catch (err) {
      console.warn(`[Route] OpenSky/ADSBDB failed:`, err);
    }
  }

  // Sort by departure time
  allFlights.sort((a, b) => a.departureTimestamp - b.departureTimestamp);

  const result: RouteSearchResult = {
    flights: allFlights,
    rateLimited: allFlights.length === 0 && openskyRateLimited,
    openskyRateLimited,
    error: allFlights.length === 0 && openskyRateLimited
      ? 'All data sources unavailable or rate limited'
      : null,
    totalDepartures: allFlights.length,
    verifiedCount,
    dataSources,
  };

  // Cache for 15 minutes (schedule data is stable)
  cacheSet(routeCacheKey, result, 15 * 60 * 1000);
  return result;
}

// =============================================================================
// Helpers
// =============================================================================

function getCarrierFullName(iataCode: string): string {
  const names: Record<string, string> = {
    'DL': 'Delta Air Lines', 'AA': 'American Airlines', 'UA': 'United Airlines',
    'WN': 'Southwest Airlines', 'B6': 'JetBlue Airways', 'NK': 'Spirit Airlines',
    'F9': 'Frontier Airlines', 'AS': 'Alaska Airlines',
  };
  return names[iataCode] || iataCode;
}
