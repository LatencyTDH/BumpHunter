// Note: holidays.ts handles loading holidays_events.json
import {
  CARRIER_STATS,
  AIRCRAFT_TYPES,
  CARRIER_HUBS,
  SLOT_CONTROLLED,
  BTS_DATA_PERIOD,
  BTS_DATA_WARNING,
  ALL_HUBS,
  getOperatingCarrierStats,
  type AircraftType,
} from './data.js';
import { getWeatherSeverity } from './weather.js';
import { getFlightsForRoute, type RealFlight, type RouteSearchResult } from './opensky.js';
import { FR24_AIRCRAFT_MAP } from './fr24.js';
import { getHolidayScore, formatHolidayTag } from './holidays.js';
import { getAirportStatus, type FAAStatus } from './faa.js';
import {
  calculateCompensation,
  isLastFlightOfDay,
  type CompensationEstimate,
} from './compensation.js';
import { getFR24ScheduleForRoute, getFR24ScheduleDepartures } from './fr24.js';
import { getRouteReliability, type RouteReliability } from './otp.js';

// =============================================================================
// Bump Opportunity Index — Honest Scoring (0-100)
//
// This is a RELATIVE INDEX, not a probability. A score of 78 does NOT mean
// a 78% chance of being bumped. The actual IDB rate is ~0.028% per boarding
// (industry avg 0.28/10k, DOT ATCR 2025).
//
// The score ranks flights by relative likelihood of VDB opportunity based on:
//   1. Carrier VDB rate (22 pts) — strongest predictor, uses OPERATING carrier
//   2. Aircraft size (15 pts) — smaller = tighter margins
//   3. Timing & Demand (10 pts) — day of week + holiday/event calendar
//   4. Time of day (7 pts) — peak departure windows
//   5. Weather disruptions (11 pts) — real METAR data
//   6. Route reliability (8 pts) — BTS on-time delay rate
//   7. Cascade boost (13 pts) — downstream disruptions after hub weather
//   8. Route type (10 pts) — hub/slot-controlled dynamics
//
// Data: DOT Air Travel Consumer Report, Jan-Sep 2025 (latest available)
// Key insight: uses OPERATING carrier rates, not marketing carrier.
// AA 4533 operated by Republic Airways → scored at 9.70/10k, not AA's 3.46/10k.
// =============================================================================

export type FactorDetail = {
  name: string;
  score: number;
  maxScore: number;
  description: string;
};

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
  factorsDetailed: FactorDetail[];
  carrierDbRate: number;
  dataSource: 'fr24-schedule' | 'fr24-live' | 'opensky';
  verified: boolean;
  verificationSource: 'fr24-schedule' | 'fr24-live' | 'adsbdb' | 'opensky-estimate' | 'none';
  trackingUrl: string;
  status: string;
  registration: string;
  codeshares: string[];
  aircraftFullName: string;
  // Last-flight-of-day + DOT compensation
  lastFlightOfDay: boolean;
  compensation: CompensationEstimate;
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

const SCORE_WEIGHTS = {
  carrier: 22,
  aircraft: 15,
  timing: 10,
  timeOfDay: 7,
  weather: 11,
  reliability: 8,
  cascade: 13,
  route: 10,
};

const RAW_MAX = {
  carrier: 30,
  aircraft: 20,
  timing: 15,
  timeOfDay: 10,
  weather: 15,
  route: 10,
};

function scaleScore(raw: number, rawMax: number, weightedMax: number): number {
  if (rawMax <= 0) return 0;
  const scaled = Math.round((raw / rawMax) * weightedMax);
  return Math.max(0, Math.min(weightedMax, scaled));
}

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
// Factor 3: Timing & Demand (0-15 pts)
//
// Combines day-of-week patterns (DOT empirical data) with holiday/event
// calendar scoring. Uses the HIGHER of the two signals — holidays like
// Thanksgiving can boost an otherwise-low Wednesday to near-max score.
//
// Day-of-week base scores:
//   Sunday: 15 (highest — return travel)
//   Monday/Friday: 12 (business travel peaks)
//   Thursday: 10 | Saturday: 7 | Tue/Wed: 5
//
// Holiday intensity (from data/holidays_events.json):
//   Thanksgiving/Christmas: 15 (peak), decays by 1/day within travel window
//   Memorial/Labor Day: 10 | Spring break period: 8 | 3-day weekends: 6
//   Major events (Super Bowl, CES, SXSW): 7-10
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

function scoreTimingAndDemand(dayOfWeek: number, date: Date): { score: number; factors: string[] } {
  const day = DAY_SCORES[dayOfWeek] ?? { score: 5, label: '' };
  const holiday = getHolidayScore(date);
  const factors: string[] = [];

  // Use the higher of day-of-week or holiday score, capped at 15
  const score = Math.min(15, Math.max(day.score, holiday.score));

  if (holiday.match && holiday.score >= day.score) {
    // Holiday dominates — show holiday tag
    factors.push(formatHolidayTag(holiday.match));
  } else {
    // Day-of-week dominates
    if (day.label) factors.push(day.label);
    // Still mention holiday if it matched (secondary signal)
    if (holiday.match && holiday.score > 0) {
      factors.push(formatHolidayTag(holiday.match));
    }
  }

  return { score, factors };
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
// Factor 5: Weather & Disruption (0-15 pts)
//
// Combines real METAR weather data with FAA Ground Delay Programs / Ground
// Stops. Takes the MAX of weather score and FAA disruption score.
//
// FAA Disruption scoring:
//   Ground Stop at origin: 15 pts
//   GDP at origin: 12 pts
//   Ground Stop at dest: 10 pts
//   GDP at dest: 8 pts
//   General delay: 5 pts
//
// Weather scoring (from METAR):
//   Severe (IFR/thunderstorm): 13-15
//   Moderate (snow, low visibility): 8-10
//   Clear: 0-2
// =============================================================================

function scoreFAADisruption(
  originFAA: FAAStatus | null,
  destFAA: FAAStatus | null,
  origin: string,
  dest: string,
): { score: number; factors: string[] } {
  const factors: string[] = [];
  let score = 0;

  if (originFAA?.delay) {
    const avgStr = originFAA.avgDelay ? ` — avg ${originFAA.avgDelay}` : '';
    if (originFAA.delayType === 'GS') {
      score = Math.max(score, 15);
      factors.push(`FAA Ground Stop at ${origin}${avgStr}`);
    } else if (originFAA.delayType === 'GDP') {
      score = Math.max(score, 12);
      factors.push(`FAA Ground Delay at ${origin}${avgStr}`);
    } else if (originFAA.delayType === 'CLOSURE') {
      score = Math.max(score, 15);
      factors.push(`FAA Closure at ${origin}${avgStr}`);
    } else {
      score = Math.max(score, 5);
      factors.push(`FAA Delay at ${origin}${avgStr}`);
    }
  }

  if (destFAA?.delay) {
    const avgStr = destFAA.avgDelay ? ` — avg ${destFAA.avgDelay}` : '';
    if (destFAA.delayType === 'GS') {
      score = Math.max(score, 10);
      factors.push(`FAA Ground Stop at ${dest}${avgStr}`);
    } else if (destFAA.delayType === 'GDP') {
      score = Math.max(score, 8);
      factors.push(`FAA Ground Delay at ${dest}${avgStr}`);
    } else if (destFAA.delayType === 'CLOSURE') {
      score = Math.max(score, 10);
      factors.push(`FAA Closure at ${dest}${avgStr}`);
    } else {
      score = Math.max(score, 5);
      factors.push(`FAA Delay at ${dest}${avgStr}`);
    }
  }

  return { score: Math.min(15, score), factors };
}

function scoreWeatherAndDisruption(
  originWx: { score: number; reason: string | null },
  destWx: { score: number; reason: string | null },
  originFAA: FAAStatus | null,
  destFAA: FAAStatus | null,
  origin: string,
  dest: string,
): { score: number; factors: string[] } {
  // Weather score (original logic)
  const wxFactors: string[] = [];
  let wxScore = 0;

  if (originWx.score > 0 && originWx.reason) {
    const s = Math.min(15, Math.round(originWx.score * 0.6));
    wxScore += s;
    wxFactors.push(`Origin: ${originWx.reason}`);
  }

  if (destWx.score > 0 && destWx.reason) {
    const s = Math.min(8, Math.round(destWx.score * 0.3));
    wxScore += s;
    wxFactors.push(`Dest: ${destWx.reason}`);
  }

  wxScore = Math.min(15, wxScore);

  // FAA disruption score
  const faa = scoreFAADisruption(originFAA, destFAA, origin, dest);

  // Take max of weather vs FAA, but include all factor tags
  const allFactors = [...wxFactors, ...faa.factors];
  const score = Math.min(15, Math.max(wxScore, faa.score));

  return { score, factors: allFactors };
}

// =============================================================================
// Factor 6: Route Reliability (0-10 pts)
//
// Uses BTS on-time performance for the route. Higher delay rates boost
// bump opportunity scores, since disrupted routes create oversale pressure.
// Routes with >25% delay rate get an 8–10 point boost.
// =============================================================================

function scoreRouteReliability(
  reliability: RouteReliability | null
): { score: number; factor: string | null; description: string } {
  if (!reliability || reliability.delayPct === null) {
    return {
      score: 0,
      factor: 'BTS on-time: unavailable',
      description: 'BTS on-time data unavailable',
    };
  }

  const delay = reliability.delayPct;
  let score = 1;
  if (delay >= 35) score = 10;
  else if (delay >= 30) score = 9;
  else if (delay >= 25) score = 8;
  else if (delay >= 20) score = 6;
  else if (delay >= 15) score = 4;
  else if (delay >= 10) score = 2;

  const factor = `BTS on-time: ${delay.toFixed(1)}% late (${reliability.periodLabel})`;
  const sample = reliability.totalFlights ? `${reliability.totalFlights} flights` : 'sample unavailable';
  const description = `Delay rate ${delay.toFixed(1)}% (${sample}, ${reliability.periodLabel})`;

  return { score, factor, description };
}

// =============================================================================
// Factor 7: Cascade Boost (0-15 pts)
//
// When moderate/severe weather hits a hub, downstream flights 2–8 hours later
// become oversold as passengers rebook. Single-daily-frequency routes get the
// maximum boost (no alternative flights).
// =============================================================================

function scoreCascadeBoost(params: {
  origin: string;
  dest: string;
  depTime: string;
  date: Date;
  originWx: { score: number; reason: string | null };
  destWx: { score: number; reason: string | null };
  routeFrequency: number;
}): { score: number; factor: string | null; description: string } {
  const { origin, dest, depTime, date, originWx, destWx, routeFrequency } = params;
  const now = new Date();

  const isSameDay = now.getFullYear() === date.getFullYear()
    && now.getMonth() === date.getMonth()
    && now.getDate() === date.getDate();

  if (!isSameDay) {
    return { score: 0, factor: null, description: 'Not same-day weather window' };
  }

  const isOriginHub = ALL_HUBS.includes(origin);
  const isDestHub = ALL_HUBS.includes(dest);
  const originSeverity = isOriginHub ? originWx.score : 0;
  const destSeverity = isDestHub ? destWx.score : 0;
  const severity = Math.max(originSeverity, destSeverity);

  if (severity < 15) {
    return { score: 0, factor: null, description: 'No moderate/severe hub weather' };
  }

  const depMinutes = getTimeMinutes(depTime);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const diffMinutes = depMinutes - nowMinutes;

  if (diffMinutes < 120 || diffMinutes > 480) {
    return { score: 0, factor: null, description: 'Outside cascade window' };
  }

  const singleDaily = routeFrequency <= 1;
  let score = severity >= 25 ? 12 : 8;

  if (singleDaily) {
    score = 15;
  } else {
    if (diffMinutes >= 360) score += 2;
    else if (diffMinutes >= 240) score += 1;
    score = Math.min(15, score);
  }

  const hub = originSeverity >= destSeverity ? origin : dest;
  const severityLabel = severity >= 25 ? 'severe' : 'moderate';
  const hours = Math.round(diffMinutes / 60);

  const factor = `Cascade boost: ${severityLabel} weather at ${hub} hub (${hours}h downstream)`;
  const description = singleDaily
    ? `Single daily route — no same-day rebooking alternatives`
    : `Departs ${hours}h after ${hub} disruption (${severityLabel})`;

  return { score, factor, description };
}

// =============================================================================
// Factor 7: Route Type (0-10 pts)
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

function parseFlightNumber(fn: string): { carrier: string; num: string } | null {
  const match = fn.match(/^([A-Z]{2})(\d+)$/);
  if (!match) return null;
  return { carrier: match[1], num: match[2] };
}

function getCarrierFullName(iataCode: string): string {
  const names: Record<string, string> = {
    'DL': 'Delta Air Lines', 'AA': 'American Airlines', 'UA': 'United Airlines',
    'WN': 'Southwest Airlines', 'B6': 'JetBlue Airways', 'NK': 'Spirit Airlines',
    'F9': 'Frontier Airlines', 'AS': 'Alaska Airlines',
  };
  return names[iataCode] || iataCode;
}

// =============================================================================
// Main scoring function — combines all 7 factors
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
  originFAA: FAAStatus | null;
  destFAA: FAAStatus | null;
  routeReliability: RouteReliability | null;
  routeFrequency: number;
}): { score: number; factors: string[]; factorsDetailed: FactorDetail[]; carrierDbRate: number } {
  const { marketingCarrier, operatingCarrier, depTime, aircraft, origin, dest, dayOfWeek, originWx, destWx, originFAA, destFAA, routeReliability, routeFrequency } = params;
  const factors: string[] = [];
  const factorsDetailed: FactorDetail[] = [];

  // Factor 1: Carrier DB Rate (0-30 pts) — uses OPERATING carrier
  const f1Raw = scoreCarrierRate(operatingCarrier, marketingCarrier);
  const f1Score = scaleScore(f1Raw.score, RAW_MAX.carrier, SCORE_WEIGHTS.carrier);
  factors.push(f1Raw.factor);
  factorsDetailed.push({ name: 'Carrier Rate', score: f1Score, maxScore: SCORE_WEIGHTS.carrier, description: f1Raw.factor });

  // Factor 2: Aircraft Size (0-20 pts)
  const f2Raw = scoreAircraftSize(aircraft);
  const f2Score = scaleScore(f2Raw.score, RAW_MAX.aircraft, SCORE_WEIGHTS.aircraft);
  if (f2Raw.factor) factors.push(f2Raw.factor);
  factorsDetailed.push({ name: 'Aircraft Size', score: f2Score, maxScore: SCORE_WEIGHTS.aircraft, description: f2Raw.factor || `${aircraft.name} (${aircraft.capacity} seats)` });

  // Factor 3: Timing & Demand (0-15 pts)
  // Merges day-of-week signal with holiday/event calendar.
  const f3Raw = scoreTimingAndDemand(dayOfWeek, params.date);
  const f3Score = scaleScore(f3Raw.score, RAW_MAX.timing, SCORE_WEIGHTS.timing);
  factors.push(...f3Raw.factors);
  factorsDetailed.push({ name: 'Timing & Demand', score: f3Score, maxScore: SCORE_WEIGHTS.timing, description: f3Raw.factors.length > 0 ? f3Raw.factors.join(' · ') : 'Midweek (lower demand)' });

  // Factor 4: Time of Day (0-10 pts)
  const f4Raw = scoreTimeOfDay(depTime);
  const f4Score = scaleScore(f4Raw.score, RAW_MAX.timeOfDay, SCORE_WEIGHTS.timeOfDay);
  if (f4Raw.factor) factors.push(f4Raw.factor);
  factorsDetailed.push({ name: 'Time of Day', score: f4Score, maxScore: SCORE_WEIGHTS.timeOfDay, description: f4Raw.factor || `Departure at ${depTime}` });

  // Factor 5: Weather & Disruption (0-15 pts) — max(weather, FAA)
  const f5Raw = scoreWeatherAndDisruption(originWx, destWx, originFAA, destFAA, origin, dest);
  const f5Score = scaleScore(f5Raw.score, RAW_MAX.weather, SCORE_WEIGHTS.weather);
  factors.push(...f5Raw.factors);
  factorsDetailed.push({ name: 'Weather & Disruption', score: f5Score, maxScore: SCORE_WEIGHTS.weather, description: f5Raw.factors.length > 0 ? f5Raw.factors.join(' · ') : 'Clear conditions, no FAA delays' });

  // Factor 6: Route Reliability (0-10 pts)
  const f6Raw = scoreRouteReliability(routeReliability);
  const f6Score = scaleScore(f6Raw.score, 10, SCORE_WEIGHTS.reliability);
  if (f6Raw.factor) factors.push(f6Raw.factor);
  factorsDetailed.push({ name: 'Route Reliability', score: f6Score, maxScore: SCORE_WEIGHTS.reliability, description: f6Raw.description });

  // Factor 7: Cascade Boost (0-15 pts)
  const f7Raw = scoreCascadeBoost({ origin, dest, depTime, date: params.date, originWx, destWx, routeFrequency });
  const f7Score = scaleScore(f7Raw.score, 15, SCORE_WEIGHTS.cascade);
  if (f7Raw.factor) factors.push(f7Raw.factor);
  factorsDetailed.push({ name: 'Cascade Boost', score: f7Score, maxScore: SCORE_WEIGHTS.cascade, description: f7Raw.description });

  // Factor 8: Route Type (0-10 pts)
  const f8Raw = scoreRouteType(origin, dest, marketingCarrier);
  const f8Score = scaleScore(f8Raw.score, RAW_MAX.route, SCORE_WEIGHTS.route);
  if (f8Raw.factor) factors.push(f8Raw.factor);
  factorsDetailed.push({ name: 'Route Type', score: f8Score, maxScore: SCORE_WEIGHTS.route, description: f8Raw.factor || `${origin} → ${dest}` });

  // Sum all factors (theoretical max = 96, with 4 pts rounding buffer to 100)
  const rawScore = f1Score + f2Score + f3Score + f4Score + f5Score + f6Score + f7Score + f8Score;
  const score = Math.min(100, Math.max(5, rawScore));

  return { score, factors, factorsDetailed, carrierDbRate: f1Raw.dbRate };
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
  const date = dateStr ? new Date(dateStr + 'T12:00:00-05:00') : new Date();
  const dayOfWeek = date.getDay();

  const [originWx, destWx, originFAA, destFAA, routeReliability] = await Promise.all([
    getWeatherSeverity(originUpper),
    getWeatherSeverity(destUpper),
    getAirportStatus(originUpper),
    getAirportStatus(destUpper),
    getRouteReliability(originUpper, destUpper),
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

  // Collect all departure times for this route (for last-flight-of-day detection)
  const allRouteDepTimes = routeResult.flights.map(f => f.departureTime);

  // Supplement with FR24 schedule data (may have more flights than route result)
  try {
    const scheduleRoute = await getFR24ScheduleForRoute(originUpper, destUpper, dateStr);
    if (scheduleRoute.flights.length > 0) {
      const scheduleTimes = scheduleRoute.flights.map(f => f.depTime);
      const timeSet = new Set([...allRouteDepTimes, ...scheduleTimes]);
      allRouteDepTimes.length = 0;
      allRouteDepTimes.push(...timeSet);
    }
  } catch {
    // Best effort — schedule data is supplementary
  }

  const routeFrequency = new Set(allRouteDepTimes).size;
  const durationMin = estimateDuration(originUpper, destUpper);

  // Score each real flight
  const flights: ScoredFlight[] = [];

  for (const rf of routeResult.flights) {
    const aircraft = resolveAircraft(originUpper, destUpper, rf.carrierCode, rf.isRegional, rf.fr24AircraftCode);
    const arrTime = addMinutes(rf.departureTime, durationMin);

    // Use operating carrier for scoring (the airline that actually flies the plane)
    const operatingCarrier = rf.operatingCarrierCode || rf.carrierCode;

    const { score, factors, factorsDetailed, carrierDbRate } = computeBumpScore({
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
      originFAA,
      destFAA,
      routeReliability,
      routeFrequency,
    });

    // Calculate DOT compensation estimate
    const compensation = calculateCompensation(
      originUpper, destUpper, rf.departureTime, allRouteDepTimes, durationMin,
    );

    // Last-flight-of-day bonus: jackpot flights get a scoring boost
    let finalScore = score;
    if (compensation.lastFlightOfDay) {
      const lastFlightBonus = 8;
      finalScore = Math.min(100, score + lastFlightBonus);
      factors.push('🎰 Last flight of day — 400% rule if bumped ($1,550 max)');
      factorsDetailed.push({
        name: 'Last Flight of Day',
        score: lastFlightBonus,
        maxScore: 8,
        description: 'No more flights today on this route — bumped passengers rebook tomorrow (400% rule)',
      });
    }

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
      bumpScore: finalScore,
      factors,
      factorsDetailed,
      carrierDbRate,
      dataSource: rf.dataSource,
      verified: rf.verified,
      verificationSource: rf.verificationSource,
      trackingUrl: rf.trackingUrl,
      status: rf.status || 'Scheduled',
      registration: rf.registration || '',
      codeshares: rf.codeshares || [],
      aircraftFullName: rf.aircraftName || '',
      lastFlightOfDay: compensation.lastFlightOfDay,
      compensation,
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

// =============================================================================
// Origin-only search — score all scheduled departures from an origin
// =============================================================================

export async function scoreOriginDepartures(origin: string, dateStr: string): Promise<ScoreResult> {
  const originUpper = origin.toUpperCase();
  const date = dateStr ? new Date(`${dateStr}T12:00:00-05:00`) : new Date();
  const dayOfWeek = date.getDay();

  const [originWx, originFAA] = await Promise.all([
    getWeatherSeverity(originUpper),
    getAirportStatus(originUpper).catch(() => null),
  ]);

  let schedule;
  try {
    schedule = await getFR24ScheduleDepartures(originUpper, dateStr);
  } catch (err) {
    return {
      flights: [],
      rateLimited: false,
      openskyRateLimited: false,
      error: String(err),
      totalDepartures: 0,
      verifiedCount: 0,
      dataSources: [],
      message: 'FR24 schedule data unavailable for this origin.',
      btsDataPeriod: BTS_DATA_PERIOD,
      btsDataWarning: BTS_DATA_WARNING,
    };
  }

  if (schedule.error) {
    return {
      flights: [],
      rateLimited: false,
      openskyRateLimited: false,
      error: schedule.error,
      totalDepartures: 0,
      verifiedCount: 0,
      dataSources: [],
      message: 'FR24 schedule data unavailable for this origin.',
      btsDataPeriod: BTS_DATA_PERIOD,
      btsDataWarning: BTS_DATA_WARNING,
    };
  }

  const destWx = { score: 0, reason: null };
  const destFAA = null;

  const seenFlightNumbers = new Set<string>();
  const routeDepTimes: Record<string, string[]> = {};
  const scheduleFlights: Array<{
    destination: string;
    carrierCode: string;
    carrierName: string;
    flightNumber: string;
    callsign: string;
    departureTime: string;
    departureTimestamp: number;
    isRegional: boolean;
    fr24AircraftCode: string | null;
    trackingUrl: string;
    operatingCarrierCode: string;
    airline: string;
    aircraftName: string;
    registration: string;
    status: string;
    codeshares: string[];
  }> = [];

  for (const sf of schedule.flights) {
    const parsed = parseFlightNumber(sf.flightNumber);
    if (!parsed) continue;

    const { carrier, num } = parsed;
    if (seenFlightNumbers.has(sf.flightNumber)) continue;
    seenFlightNumbers.add(sf.flightNumber);

    const destUpper = sf.destination.toUpperCase();
    if (!routeDepTimes[destUpper]) routeDepTimes[destUpper] = [];
    routeDepTimes[destUpper].push(sf.depTime);

    const isRegional = sf.airlineIata !== '' && sf.airlineIata !== carrier;
    const carrierName = isRegional && sf.airline
      ? `${sf.airline} (${getCarrierFullName(carrier)})`
      : (sf.airline || getCarrierFullName(carrier));

    const callsign = sf.callsign || (sf.airlineIcao ? `${sf.airlineIcao}${num}` : '');

    scheduleFlights.push({
      destination: destUpper,
      carrierCode: carrier,
      carrierName,
      flightNumber: `${carrier} ${num}`,
      callsign: callsign.toUpperCase(),
      departureTime: sf.depTime,
      departureTimestamp: sf.departureTimestamp,
      isRegional,
      fr24AircraftCode: sf.aircraftCode || null,
      trackingUrl: `https://www.flightaware.com/live/flight/${callsign || carrier + num}`,
      operatingCarrierCode: sf.airlineIata || carrier,
      airline: sf.airline,
      aircraftName: sf.aircraftName,
      registration: sf.registration,
      status: sf.isLive ? 'In Air' : (sf.status || 'Scheduled'),
      codeshares: sf.codeshares || [],
    });
  }

  const flights: ScoredFlight[] = [];

  for (const sf of scheduleFlights) {
    const destUpper = sf.destination;
    const routeTimes = routeDepTimes[destUpper] || [];
    const durationMin = estimateDuration(originUpper, destUpper);
    const aircraft = resolveAircraft(originUpper, destUpper, sf.carrierCode, sf.isRegional, sf.fr24AircraftCode);
    const arrTime = addMinutes(sf.departureTime, durationMin);

    const { score, factors, factorsDetailed, carrierDbRate } = computeBumpScore({
      marketingCarrier: sf.carrierCode,
      operatingCarrier: sf.operatingCarrierCode,
      depTime: sf.departureTime,
      aircraft,
      origin: originUpper,
      dest: destUpper,
      date,
      dayOfWeek,
      originWx,
      destWx,
      originFAA,
      destFAA,
      routeReliability: null, // Skip per-route BTS in flex search (too many destinations)
      routeFrequency: routeTimes.length || 1,
    });

    const compensation = calculateCompensation(
      originUpper, destUpper, sf.departureTime, routeTimes, durationMin,
    );

    let finalScore = score;
    if (compensation.lastFlightOfDay) {
      const lastFlightBonus = 8;
      finalScore = Math.min(100, score + lastFlightBonus);
      factors.push('🎰 Last flight of day — 400% rule if bumped ($1,550 max)');
      factorsDetailed.push({
        name: 'Last Flight of Day',
        score: lastFlightBonus,
        maxScore: 8,
        description: 'No more flights today on this route — bumped passengers rebook tomorrow (400% rule)',
      });
    }

    flights.push({
      id: `${sf.callsign || sf.flightNumber}-${dateStr}`,
      airline: sf.carrierName,
      carrier: sf.carrierCode,
      flightNumber: sf.flightNumber,
      callsign: sf.callsign,
      departure: originUpper,
      arrival: destUpper,
      depTime: sf.departureTime,
      arrTime,
      aircraft: sf.aircraftName || aircraft.name,
      aircraftCode: sf.fr24AircraftCode || aircraft.iataCode,
      capacity: aircraft.capacity,
      isRegional: sf.isRegional || aircraft.isRegional,
      bumpScore: finalScore,
      factors,
      factorsDetailed,
      carrierDbRate,
      dataSource: 'fr24-schedule',
      verified: true,
      verificationSource: 'fr24-schedule',
      trackingUrl: sf.trackingUrl,
      status: sf.status || 'Scheduled',
      registration: sf.registration || '',
      codeshares: sf.codeshares || [],
      aircraftFullName: sf.aircraftName || '',
      lastFlightOfDay: compensation.lastFlightOfDay,
      compensation,
    });
  }

  flights.sort((a, b) => b.bumpScore - a.bumpScore);

  const topFlights = flights.slice(0, 20);
  const message = flights.length > 0
    ? `Showing top 20 bump opportunities from ${originUpper} (schedule-based).`
    : `No scheduled departures found for ${originUpper} on ${dateStr}.`;

  return {
    flights: topFlights,
    rateLimited: false,
    openskyRateLimited: false,
    error: schedule.error,
    totalDepartures: flights.length,
    verifiedCount: flights.length,
    dataSources: ['FlightRadar24 (schedule)'],
    message,
    btsDataPeriod: BTS_DATA_PERIOD,
    btsDataWarning: BTS_DATA_WARNING,
  };
}
