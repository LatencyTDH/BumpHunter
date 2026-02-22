import {
  CARRIER_STATS,
  ROUTE_LOAD_FACTORS,
  AIRCRAFT_TYPES,
  type AircraftType,
} from './data.js';
import { getWeatherSeverity } from './weather.js';
import { getFlightsForRoute, type RealFlight, type RouteSearchResult } from './opensky.js';
import { FR24_AIRCRAFT_MAP } from './fr24.js';

// =============================================================================
// Bump Probability Scoring Algorithm
//
// Scores REAL flights from FR24 + OpenSky + ADSBDB.
// NO FAKE DATA. NO SCHEDULE TEMPLATES. NO FALLBACKS.
// =============================================================================

export type ScoredFlight = {
  id: string;
  airline: string;
  carrier: string;
  flightNumber: string;
  callsign: string;        // ICAO callsign (e.g. "DAL323")
  departure: string;
  arrival: string;
  depTime: string;
  arrTime: string;
  aircraft: string;
  aircraftCode: string;
  capacity: number;
  isRegional: boolean;
  bumpScore: number;
  factors: string[];
  loadFactor: number;
  carrierDbRate: number;
  dataSource: 'fr24-schedule' | 'fr24-live' | 'opensky';
  verified: boolean;
  verificationSource: 'fr24-schedule' | 'fr24-live' | 'adsbdb' | 'opensky-estimate' | 'none';
  trackingUrl: string;
  // Rich fields from FR24 Schedule API
  status: string;           // "Scheduled", "In Air", "Estimated dep 07:48", etc.
  registration: string;     // "N848DN"
  codeshares: string[];     // ["AF6825", "KE7079"]
  aircraftFullName: string; // "Airbus A321-211" (from schedule API)
};

export type ScoreResult = {
  flights: ScoredFlight[];
  rateLimited: boolean;
  openskyRateLimited: boolean;
  error: string | null;
  totalDepartures: number;
  verifiedCount: number;
  dataSources: string[];
  message: string | null;
};

function getTimeMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function addMinutes(time: string, mins: number): string {
  const total = getTimeMinutes(time) + mins;
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function isHolidayPeriod(date: Date): boolean {
  const month = date.getMonth();
  const day = date.getDate();
  if (month === 10 && day >= 20 && day <= 30) return true;
  if (month === 11 && day >= 20) return true;
  if (month === 0 && day <= 3) return true;
  if (month === 4 && day >= 24) return true;
  if (month === 6 && day >= 1 && day <= 7) return true;
  if (month === 8 && day <= 7) return true;
  if (month === 2 && day >= 10) return true;
  if (month === 3 && day <= 15) return true;
  return false;
}

function isSummerPeak(date: Date): boolean {
  const month = date.getMonth();
  return month >= 5 && month <= 7;
}

function estimateDuration(origin: string, dest: string): number {
  const distances: Record<string, number> = {
    'ATL-LGA': 145, 'ATL-JFK': 155, 'ATL-ORD': 135, 'ATL-DFW': 160,
    'ATL-MCO': 95, 'ATL-EWR': 140, 'ATL-DEN': 215, 'ATL-LAS': 265,
    'ATL-CLT': 70, 'ATL-BOS': 170, 'ATL-DCA': 115, 'ATL-LAX': 280,
    'ATL-SFO': 300, 'ATL-MIA': 110, 'ATL-SEA': 310,
    'DFW-ORD': 155, 'DFW-LGA': 195, 'DFW-EWR': 200, 'DFW-LAS': 195,
    'DFW-DEN': 155, 'DFW-MCO': 155, 'DFW-LAX': 195, 'DFW-MIA': 170,
    'DFW-JFK': 205, 'DFW-SFO': 225, 'DFW-PHX': 170, 'DFW-CLT': 140,
    'EWR-ORD': 155, 'EWR-DEN': 260, 'EWR-LAS': 315, 'EWR-LAX': 340,
    'EWR-SFO': 355, 'EWR-MCO': 165, 'EWR-MIA': 190, 'EWR-BOS': 70,
    'EWR-CLT': 110, 'ORD-LGA': 130, 'ORD-DEN': 195, 'ORD-LAS': 235,
    'ORD-DFW': 160, 'ORD-LAX': 255, 'ORD-SFO': 265, 'ORD-MCO': 170,
    'ORD-MIA': 195, 'ORD-JFK': 140, 'ORD-BOS': 145, 'ORD-DCA': 115,
    'ORD-SEA': 260, 'ORD-MSP': 90, 'DEN-LAS': 150, 'DEN-ORD': 165,
    'DEN-LGA': 225, 'DEN-LAX': 165, 'DEN-SFO': 175, 'DEN-DFW': 155,
    'DEN-PHX': 140, 'DEN-SEA': 175, 'DEN-MSP': 145, 'LGA-DCA': 55,
    'LGA-BOS': 65, 'LGA-CLT': 120, 'LGA-MIA': 185, 'LGA-MCO': 170,
    'JFK-LAX': 330, 'JFK-SFO': 345, 'JFK-MCO': 170, 'JFK-MIA': 190,
    'CLT-LGA': 120, 'CLT-EWR': 115, 'CLT-ORD': 145, 'CLT-DFW': 180,
    'CLT-BOS': 135, 'CLT-MCO': 100, 'CLT-MIA': 130, 'CLT-DCA': 75,
    'MCO-EWR': 165, 'MCO-ORD': 175, 'MCO-DFW': 155, 'MCO-LGA': 170,
    'MCO-JFK': 170, 'MCO-CLT': 100, 'MCO-BOS': 180,
    'LAS-LAX': 65, 'LAS-DEN': 145, 'LAS-DFW': 195, 'LAS-ORD': 235,
    'LAS-SFO': 90, 'LAS-EWR': 310, 'LAS-PHX': 70,
  };
  return distances[`${origin}-${dest}`] ?? distances[`${dest}-${origin}`] ?? 150;
}

function resolveAircraft(origin: string, dest: string, carrier: string, isRegional: boolean, fr24Code: string | null): AircraftType {
  // Try FR24 aircraft code first (real data)
  if (fr24Code) {
    const mapped = FR24_AIRCRAFT_MAP[fr24Code];
    if (mapped && AIRCRAFT_TYPES[mapped]) {
      return AIRCRAFT_TYPES[mapped];
    }
  }

  // Fallback to estimation by carrier/route
  if (isRegional) {
    return AIRCRAFT_TYPES['E175'] || AIRCRAFT_TYPES['CRJ900'];
  }

  const duration = estimateDuration(origin, dest);
  const isShortHaul = duration <= 90;
  const isLongHaul = duration >= 250;

  const carrierDefaults: Record<string, Record<string, string>> = {
    'DL': { short: 'E175', medium: 'B737', long: 'B767' },
    'AA': { short: 'E175', medium: 'A321', long: 'B757' },
    'UA': { short: 'E175', medium: 'B737MAX', long: 'B757' },
    'WN': { short: 'B737MAX', medium: 'B737MAX', long: 'B737MAX' },
    'B6': { short: 'A320', medium: 'A320', long: 'A321' },
    'NK': { short: 'A320', medium: 'A320', long: 'A321' },
    'F9': { short: 'A320', medium: 'A320', long: 'A321' },
    'AS': { short: 'E175', medium: 'B737', long: 'B737' },
  };

  const range = isShortHaul ? 'short' : isLongHaul ? 'long' : 'medium';
  const key = carrierDefaults[carrier]?.[range] || 'B737';
  return AIRCRAFT_TYPES[key] || AIRCRAFT_TYPES['B737'];
}

function computeBumpScore(params: {
  carrier: string;
  depTime: string;
  aircraft: AircraftType;
  origin: string;
  dest: string;
  date: Date;
  dayOfWeek: number;
  baseRouteLF: number;
  isPeakDay: boolean;
  isLeisureRoute: boolean;
  originWx: { score: number; reason: string | null };
  destWx: { score: number; reason: string | null };
}): { score: number; factors: string[]; effectiveLF: number } {
  const {
    carrier: carrierCode, depTime, aircraft, origin, date, dayOfWeek,
    baseRouteLF, isPeakDay, isLeisureRoute, originWx, destWx,
  } = params;

  const carrier = CARRIER_STATS[carrierCode];
  if (!carrier) return { score: 25, factors: [], effectiveLF: baseRouteLF };

  let score = 25;
  const factors: string[] = [];

  // 1. Carrier Historical DB Rate (0-15 points)
  const carrierScore = Math.min(15, Math.round(carrier.dbRate * 12));
  score += carrierScore;
  if (carrierScore >= 8) factors.push(`${carrier.name} high DB rate (${carrier.dbRate}/10k)`);

  // 2. Route Load Factor (0-20 points)
  let effectiveLF = baseRouteLF;
  if (isPeakDay) effectiveLF = Math.min(0.98, effectiveLF + 0.04);
  const lfScore = Math.max(0, Math.min(20, Math.round((effectiveLF - 0.80) * 133)));
  score += lfScore;
  if (effectiveLF >= 0.88) factors.push(`High load factor (${Math.round(effectiveLF * 100)}%)`);

  // 3. Day of Week (0-15 points)
  if (dayOfWeek === 1 || dayOfWeek === 4 || dayOfWeek === 5) {
    score += 15; factors.push('Peak business travel day');
  } else if (dayOfWeek === 0) {
    score += 10; factors.push('Sunday return travel surge');
  } else if (dayOfWeek === 6 && isLeisureRoute) {
    score += 12; factors.push('Weekend leisure route demand');
  } else {
    score += 2;
  }

  // 4. Time of Day (0-15 points)
  const depMinutes = getTimeMinutes(depTime);
  if (depMinutes >= 1080) { score += 15; factors.push('Last bank of the day'); }
  else if (depMinutes >= 960) { score += 12; factors.push('Late afternoon departure'); }
  else if (depMinutes <= 480) { score += 10; factors.push('Early morning business rush'); }
  else if (depMinutes <= 600) { score += 8; factors.push('Morning peak departure'); }
  else { score += 3; }

  // 5. Aircraft Type (0-20 points)
  if (aircraft.isRegional) {
    score += 20; factors.push(`Regional jet (${aircraft.name}, ${aircraft.capacity} seats)`);
  } else if (aircraft.capacity <= 140) {
    score += 12; factors.push(`Small narrowbody (${aircraft.name}, ${aircraft.capacity} seats)`);
  } else if (aircraft.capacity <= 180) {
    score += 8; factors.push(`Standard narrowbody (${aircraft.capacity} seats)`);
  } else if (aircraft.capacity <= 200) {
    score += 4;
  }

  // 6. Weather Disruptions (0-25 points each)
  if (originWx.score > 0 && originWx.reason) {
    score += originWx.score; factors.push(`Origin: ${originWx.reason}`);
  }
  if (destWx.score > 0 && destWx.reason) {
    score += Math.round(destWx.score * 0.6); factors.push(`Destination: ${destWx.reason}`);
  }

  // 7. Seasonal/Holiday (0-10 points)
  if (isHolidayPeriod(date)) { score += 10; factors.push('Holiday travel period'); }
  else if (isSummerPeak(date)) { score += 5; factors.push('Summer peak season'); }

  // 8. Fortress Hub bonus
  if (carrierCode === 'DL' && origin === 'ATL') { score += 5; factors.push('Delta fortress hub dynamics'); }
  else if (carrierCode === 'AA' && (origin === 'DFW' || origin === 'CLT')) { score += 5; factors.push('American fortress hub dynamics'); }
  else if (carrierCode === 'UA' && (origin === 'EWR' || origin === 'ORD' || origin === 'DEN')) { score += 5; factors.push('United fortress hub dynamics'); }

  score = Math.min(98, Math.max(5, score));
  return { score, factors, effectiveLF };
}

// =============================================================================
// Score flights using ONLY real data (FR24 + OpenSky + ADSBDB)
// =============================================================================

export async function scoreFlights(
  origin: string,
  dest: string,
  dateStr: string
): Promise<ScoreResult> {
  const originUpper = origin.toUpperCase();
  const destUpper = dest.toUpperCase();
  const date = dateStr ? new Date(dateStr + 'T12:00:00') : new Date();
  const dayOfWeek = date.getDay();

  const routeLF = ROUTE_LOAD_FACTORS.find(
    r => (r.origin === originUpper && r.dest === destUpper) ||
         (r.origin === destUpper && r.dest === originUpper)
  );
  const baseRouteLF = routeLF?.loadFactor ?? 0.83;
  const isPeakDay = routeLF?.peakDays.includes(dayOfWeek) ?? false;
  const isLeisureRoute = routeLF?.isLeisure ?? false;

  const [originWx, destWx] = await Promise.all([
    getWeatherSeverity(originUpper),
    getWeatherSeverity(destUpper),
  ]);

  // Fetch real flights from all sources
  let routeResult: RouteSearchResult;
  try {
    routeResult = await getFlightsForRoute(originUpper, destUpper, dateStr);
    console.log(`[Scoring] ${routeResult.flights.length} real flights for ${originUpper}→${destUpper} from [${routeResult.dataSources.join(', ')}]`);
  } catch (err) {
    console.warn(`[Scoring] Flight fetch failed:`, err);
    return {
      flights: [], rateLimited: false, openskyRateLimited: false,
      error: `Flight data fetch failed: ${err}`,
      totalDepartures: 0, verifiedCount: 0, dataSources: [],
      message: 'Unable to fetch real-time flight data. Please try again later.',
    };
  }

  // If no data at all
  if (routeResult.flights.length === 0) {
    let message: string;
    if (routeResult.rateLimited) {
      message = 'Real-time flight data is temporarily unavailable (rate limit). FlightRadar24 and OpenSky Network both returned no results. Try again in a few minutes.';
    } else {
      message = `No flights found for ${originUpper}→${destUpper} right now. This route may not have active flights at this time, or the data sources may be temporarily unavailable.`;
    }
    return {
      flights: [], rateLimited: routeResult.rateLimited,
      openskyRateLimited: routeResult.openskyRateLimited,
      error: routeResult.error,
      totalDepartures: 0, verifiedCount: 0,
      dataSources: routeResult.dataSources,
      message,
    };
  }

  // Score each real flight
  const flights: ScoredFlight[] = [];

  for (const rf of routeResult.flights) {
    const aircraft = resolveAircraft(originUpper, destUpper, rf.carrierCode, rf.isRegional, rf.fr24AircraftCode);
    const durationMin = estimateDuration(originUpper, destUpper);
    const arrTime = addMinutes(rf.departureTime, durationMin);

    const { score, factors, effectiveLF } = computeBumpScore({
      carrier: rf.carrierCode, depTime: rf.departureTime, aircraft,
      origin: originUpper, dest: destUpper, date, dayOfWeek,
      baseRouteLF, isPeakDay, isLeisureRoute, originWx, destWx,
    });

    const carrierStats = CARRIER_STATS[rf.carrierCode];

    // Prefer the schedule API's full aircraft name when available
    const aircraftDisplayName = rf.aircraftName || aircraft.name;

    flights.push({
      id: `${rf.callsign || rf.flightNumber}-${dateStr}`,
      airline: rf.carrierName,
      carrier: rf.carrierCode,
      flightNumber: rf.flightNumber,
      callsign: rf.callsign,
      departure: originUpper,
      arrival: destUpper,
      depTime: rf.departureTime,
      arrTime,
      aircraft: aircraftDisplayName,
      aircraftCode: rf.fr24AircraftCode || aircraft.iataCode,
      capacity: aircraft.capacity,
      isRegional: rf.isRegional || aircraft.isRegional,
      bumpScore: score,
      factors,
      loadFactor: effectiveLF,
      carrierDbRate: carrierStats?.dbRate ?? 0.5,
      dataSource: rf.dataSource,
      verified: rf.verified,
      verificationSource: rf.verificationSource,
      trackingUrl: rf.trackingUrl,
      status: rf.status || 'Scheduled',
      registration: rf.registration || '',
      codeshares: rf.codeshares || [],
      aircraftFullName: rf.aircraftName || '',
    });
  }

  flights.sort((a, b) => b.bumpScore - a.bumpScore);

  // Build message about data sources
  let message: string | null = null;
  if (routeResult.openskyRateLimited && routeResult.dataSources.length > 0) {
    message = 'OpenSky Network is rate limited. Showing live flights from FlightRadar24.';
  }

  return {
    flights,
    rateLimited: false,
    openskyRateLimited: routeResult.openskyRateLimited,
    error: routeResult.error,
    totalDepartures: routeResult.totalDepartures,
    verifiedCount: routeResult.verifiedCount,
    dataSources: routeResult.dataSources,
    message,
  };
}
