import {
  CARRIER_STATS,
  AIRCRAFT_TYPES,
  CARRIER_HUBS,
  SLOT_CONTROLLED,
  BTS_DATA_PERIOD,
  BTS_DATA_WARNING,
  getOperatingCarrierStats,
  type AircraftType,
} from './data.js';
import { getWeatherSeverity } from './weather.js';
import { getFlightsForRoute, type RealFlight, type RouteSearchResult } from './opensky.js';
import { FR24_AIRCRAFT_MAP } from './fr24.js';

// =============================================================================
// Bump Opportunity Index — Honest Scoring (0-100)
//
// This is a RELATIVE INDEX, not a probability. A score of 78 does NOT mean
// a 78% chance of being bumped. The actual IDB rate is ~0.028% per boarding
// (industry avg 0.28/10k, DOT ATCR 2025).
//
// The score ranks flights by relative likelihood of VDB opportunity based on:
//   1. Carrier VDB rate (30 pts) — strongest predictor, uses OPERATING carrier
//   2. Aircraft size (20 pts) — smaller = tighter margins
//   3. Day of week (15 pts) — empirical DOT patterns
//   4. Time of day (10 pts) — peak departure windows
//   5. Weather disruptions (15 pts) — real METAR data
//   6. Route type (10 pts) — hub/slot-controlled dynamics
//
// Data: DOT Air Travel Consumer Report, Jan-Sep 2025 (latest available)
// Key insight: uses OPERATING carrier rates, not marketing carrier.
// AA 4533 operated by Republic Airways → scored at 9.70/10k, not AA's 3.46/10k.
// =============================================================================

export type ScoredFlight = {
  id: string;
  airline: string;
  carrier: string;
  flightNumber: string;
  callsign: string;
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
  carrierDbRate: number;
  dataSource: 'fr24-schedule' | 'fr24-live' | 'opensky';
  verified: boolean;
  verificationSource: 'fr24-schedule' | 'fr24-live' | 'adsbdb' | 'opensky-estimate' | 'none';
  trackingUrl: string;
  status: string;
  registration: string;
  codeshares: string[];
  aircraftFullName: string;
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
  btsDataPeriod: string;
  btsDataWarning: string;
};

// =============================================================================
// Factor 1: Carrier DB Rate (0-30 pts)
//
// Uses the OPERATING carrier's total DB rate (VDB + IDB) since VDB is the
// opportunity. Normalized to a 0-30 scale.
//
// 2025 ATCR data shows massive spread:
//   Republic YX: 9.70/10k (regional operator — goldmine)
//   SkyWest OO:  9.43/10k (regional operator)
//   Delta DL:    5.68/10k (all VDB, zero IDB — best VDB opportunity)
//   Hawaiian HA: 0.09/10k (basically never bumps)
//
// The scoring weights total DB because VDB means the airline is actively
// seeking volunteers — that's the money-making opportunity.
// =============================================================================

function scoreCarrierRate(
  operatingCarrierCode: string,
  marketingCarrierCode: string,
): { score: number; factor: string; operatorName: string; dbRate: number } {
  const { stats, isOperatorMatch } = getOperatingCarrierStats(operatingCarrierCode, marketingCarrierCode);

  // Get all carrier DB rates for normalization
  const allRates = Object.values(CARRIER_STATS).map(c => c.dbRate);
  const maxRate = Math.max(...allRates);
  const minRate = Math.min(...allRates);

  // Linear scale: minRate → 5, maxRate → 28
  const range = maxRate - minRate;
  const normalized = range > 0
    ? 5 + ((stats.dbRate - minRate) / range) * 23
    : 15;

  const score = Math.round(Math.min(30, Math.max(3, normalized)));

  // Build honest factor tag
  let factor: string;
  if (isOperatorMatch && operatingCarrierCode !== marketingCarrierCode) {
    // Operating carrier is different from marketing — show both
    factor = `${stats.name} VDB: ${stats.vdbRate.toFixed(2)}/10k (DOT ATCR 2025)`;
  } else {
    factor = `${stats.name} DB: ${stats.dbRate.toFixed(2)}/10k (ATCR 2025)`;
  }

  return { score, factor, operatorName: stats.name, dbRate: stats.dbRate };
}

// =============================================================================
// Factor 2: Aircraft Size (0-20 pts)
//
// Smaller aircraft = tighter booking margins = more likely oversold.
// Regional jets (<100 seats): 18-20 pts
// Narrow body (100-200 seats): 10-14 pts
// Wide body (>200 seats): 3-6 pts
// =============================================================================

function scoreAircraftSize(aircraft: AircraftType): { score: number; factor: string | null } {
  if (aircraft.isRegional || aircraft.capacity < 100) {
    const score = aircraft.capacity <= 76 ? 20 : 18;
    return { score, factor: `Regional jet (${aircraft.name}, ${aircraft.capacity} seats)` };
  }
  if (aircraft.capacity <= 140) {
    return { score: 14, factor: `Small narrowbody (${aircraft.name}, ${aircraft.capacity} seats)` };
  }
  if (aircraft.capacity <= 180) {
    return { score: 11, factor: null }; // standard narrowbody, no special tag
  }
  if (aircraft.capacity <= 200) {
    return { score: 8, factor: null };
  }
  // Wide body (>200 seats)
  const score = Math.max(3, 6 - Math.floor((aircraft.capacity - 200) / 50));
  return { score, factor: `Wide body (${aircraft.name}, ${aircraft.capacity} seats)` };
}

// =============================================================================
// Factor 3: Day of Week (0-15 pts)
//
// Based on DOT data showing which days historically have highest DB rates.
// Sunday: 15 (highest — return travel)
// Monday/Friday: 12 (business travel peaks)
// Thursday: 10
// Saturday: 7
// Tuesday/Wednesday: 5
// =============================================================================

const DAY_SCORES: Record<number, { score: number; label: string }> = {
  0: { score: 15, label: 'Sunday return travel' },
  1: { score: 12, label: 'Monday business peak' },
  2: { score: 5,  label: '' },
  3: { score: 5,  label: '' },
  4: { score: 10, label: 'Thursday pre-weekend travel' },
  5: { score: 12, label: 'Friday departure peak' },
  6: { score: 7,  label: 'Saturday leisure travel' },
};

function scoreDayOfWeek(dayOfWeek: number): { score: number; factor: string | null } {
  const day = DAY_SCORES[dayOfWeek] ?? { score: 5, label: '' };
  return { score: day.score, factor: day.label || null };
}

// =============================================================================
// Factor 4: Time of Day (0-10 pts)
//
// Peak departure times have higher demand → more overbooking.
// 6-9 AM: 9-10 (morning business rush)
// 5-8 PM: 8-9 (evening rush)
// 10 AM-4 PM: 5-6
// Late night/early AM: 2-3
// =============================================================================

function scoreTimeOfDay(depTime: string): { score: number; factor: string | null } {
  const [h, m] = depTime.split(':').map(Number);
  const minutes = h * 60 + (m || 0);

  if (minutes >= 360 && minutes < 540) {
    // 6:00 - 8:59 AM
    const score = minutes < 420 ? 9 : 10; // 7-9 AM is peak
    return { score, factor: `Morning peak (${depTime})` };
  }
  if (minutes >= 1020 && minutes < 1200) {
    // 5:00 - 7:59 PM
    const score = minutes >= 1080 ? 9 : 8; // 6+ PM is peak
    return { score, factor: `Evening rush (${depTime})` };
  }
  if (minutes >= 1200) {
    // 8 PM+ (last bank)
    return { score: 7, factor: `Last bank departure (${depTime})` };
  }
  if (minutes >= 540 && minutes < 960) {
    // 9 AM - 3:59 PM
    return { score: 5, factor: null };
  }
  // Early AM (before 6 AM) or very late
  return { score: 2, factor: null };
}

// =============================================================================
// Factor 5: Weather Disruptions (0-15 pts)
//
// From real METAR data via aviationweather.gov.
// Severe (IFR/thunderstorm): 13-15
// Moderate (snow, low visibility): 8-10
// Clear: 0-2
// =============================================================================

function scoreWeather(
  originWx: { score: number; reason: string | null },
  destWx: { score: number; reason: string | null }
): { score: number; factors: string[] } {
  const factors: string[] = [];
  let score = 0;

  if (originWx.score > 0 && originWx.reason) {
    const wxScore = Math.min(15, Math.round(originWx.score * 0.6));
    score += wxScore;
    factors.push(`Origin: ${originWx.reason}`);
  }

  if (destWx.score > 0 && destWx.reason) {
    const wxScore = Math.min(8, Math.round(destWx.score * 0.3));
    score += wxScore;
    factors.push(`Dest: ${destWx.reason}`);
  }

  score = Math.min(15, score);
  return { score, factors };
}

// =============================================================================
// Factor 6: Route Type (0-10 pts)
//
// Hub-to-hub routes with high demand score higher.
// Hub departure to slot-controlled airport (LGA/DCA/JFK): 8-10
// Hub-to-hub: 6-8
// Regular routes: 3-5
// =============================================================================

function scoreRouteType(
  origin: string,
  dest: string,
  carrierCode: string
): { score: number; factor: string | null } {
  const carrierHubs = CARRIER_HUBS[carrierCode] || [];
  const isCarrierHub = carrierHubs.includes(origin);
  const isDestSlotControlled = SLOT_CONTROLLED.has(dest);
  const isDestHub = Object.values(CARRIER_HUBS).some(hubs => hubs.includes(dest));

  if (isCarrierHub && isDestSlotControlled) {
    return { score: 10, factor: `${origin} hub → ${dest} (slot-controlled)` };
  }
  if (isCarrierHub && isDestHub) {
    return { score: 7, factor: `Hub-to-hub route (${origin}→${dest})` };
  }
  if (isCarrierHub) {
    return { score: 5, factor: null };
  }
  if (isDestSlotControlled) {
    return { score: 6, factor: `→ ${dest} (slot-controlled)` };
  }
  return { score: 3, factor: null };
}

// =============================================================================
// Utility functions
// =============================================================================

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
  if (fr24Code) {
    const mapped = FR24_AIRCRAFT_MAP[fr24Code];
    if (mapped && AIRCRAFT_TYPES[mapped]) {
      return AIRCRAFT_TYPES[mapped];
    }
  }

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

// =============================================================================
// Main scoring function — combines all 6 factors
// =============================================================================

function computeBumpScore(params: {
  marketingCarrier: string;
  operatingCarrier: string;
  depTime: string;
  aircraft: AircraftType;
  origin: string;
  dest: string;
  date: Date;
  dayOfWeek: number;
  originWx: { score: number; reason: string | null };
  destWx: { score: number; reason: string | null };
}): { score: number; factors: string[]; carrierDbRate: number } {
  const { marketingCarrier, operatingCarrier, depTime, aircraft, origin, dest, dayOfWeek, originWx, destWx } = params;
  const factors: string[] = [];

  // Factor 1: Carrier DB Rate (0-30 pts) — uses OPERATING carrier
  const f1 = scoreCarrierRate(operatingCarrier, marketingCarrier);
  factors.push(f1.factor);

  // Factor 2: Aircraft Size (0-20 pts)
  const f2 = scoreAircraftSize(aircraft);
  if (f2.factor) factors.push(f2.factor);

  // Factor 3: Day of Week (0-15 pts)
  const f3 = scoreDayOfWeek(dayOfWeek);
  if (f3.factor) factors.push(f3.factor);

  // Factor 4: Time of Day (0-10 pts)
  const f4 = scoreTimeOfDay(depTime);
  if (f4.factor) factors.push(f4.factor);

  // Factor 5: Weather (0-15 pts)
  const f5 = scoreWeather(originWx, destWx);
  factors.push(...f5.factors);

  // Factor 6: Route Type (0-10 pts)
  const f6 = scoreRouteType(origin, dest, marketingCarrier);
  if (f6.factor) factors.push(f6.factor);

  // Sum all factors (theoretical max = 100)
  const rawScore = f1.score + f2.score + f3.score + f4.score + f5.score + f6.score;
  const score = Math.min(100, Math.max(5, rawScore));

  return { score, factors, carrierDbRate: f1.dbRate };
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
      btsDataPeriod: BTS_DATA_PERIOD,
      btsDataWarning: BTS_DATA_WARNING,
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
      btsDataPeriod: BTS_DATA_PERIOD,
      btsDataWarning: BTS_DATA_WARNING,
    };
  }

  // Score each real flight
  const flights: ScoredFlight[] = [];

  for (const rf of routeResult.flights) {
    const aircraft = resolveAircraft(originUpper, destUpper, rf.carrierCode, rf.isRegional, rf.fr24AircraftCode);
    const durationMin = estimateDuration(originUpper, destUpper);
    const arrTime = addMinutes(rf.departureTime, durationMin);

    // Use operating carrier for scoring (the airline that actually flies the plane)
    const operatingCarrier = rf.operatingCarrierCode || rf.carrierCode;

    const { score, factors, carrierDbRate } = computeBumpScore({
      marketingCarrier: rf.carrierCode,
      operatingCarrier,
      depTime: rf.departureTime,
      aircraft,
      origin: originUpper,
      dest: destUpper,
      date,
      dayOfWeek,
      originWx,
      destWx,
    });

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
      carrierDbRate,
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
    btsDataPeriod: BTS_DATA_PERIOD,
    btsDataWarning: BTS_DATA_WARNING,
  };
}
