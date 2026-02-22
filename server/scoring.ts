import {
  CARRIER_STATS,
  ROUTE_LOAD_FACTORS,
  AIRCRAFT_TYPES,
  SCHEDULE_TEMPLATES,
  type ScheduleTemplate,
  type AircraftType,
} from './data.js';
import { getWeatherSeverity } from './weather.js';
import { getFlightsForRoute, type RealFlight } from './opensky.js';

// =============================================================================
// Bump Probability Scoring Algorithm
//
// Inputs:
//   1. Carrier historical denied boarding rate (BTS data)
//   2. Route load factor (BTS T-100 data)
//   3. Day of week patterns
//   4. Time of day (bank position)
//   5. Aircraft type & capacity constraints
//   6. Live weather disruptions (aviationweather.gov)
//   7. Seasonal/holiday adjustments
//   8. REAL flight data from OpenSky Network (callsigns, departure times)
//
// Output: 0-98 bump probability score + contributing factors
// =============================================================================

export type ScoredFlight = {
  id: string;
  airline: string;
  carrier: string;
  flightNumber: string;
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
  dataSource: 'opensky' | 'schedule'; // Track where the flight came from
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
  const month = date.getMonth(); // 0-indexed
  const day = date.getDate();

  // Thanksgiving week (late November)
  if (month === 10 && day >= 20 && day <= 30) return true;
  // Christmas/New Year (Dec 20 - Jan 3)
  if (month === 11 && day >= 20) return true;
  if (month === 0 && day <= 3) return true;
  // Memorial Day weekend (last Mon of May - approximate)
  if (month === 4 && day >= 24) return true;
  // July 4th week
  if (month === 6 && day >= 1 && day <= 7) return true;
  // Labor Day weekend (first Mon of Sep - approximate)
  if (month === 8 && day <= 7) return true;
  // Spring break (mid-March to mid-April)
  if (month === 2 && day >= 10) return true;
  if (month === 3 && day <= 15) return true;

  return false;
}

function isSummerPeak(date: Date): boolean {
  const month = date.getMonth();
  return month >= 5 && month <= 7; // June-August
}

// Estimate flight duration based on route (using schedule templates as reference)
function estimateDuration(origin: string, dest: string, carrier: string): number {
  const template = SCHEDULE_TEMPLATES.find(
    t => t.origin === origin && t.destination === dest && t.carrier === carrier
  ) || SCHEDULE_TEMPLATES.find(
    t => t.origin === origin && t.destination === dest
  );
  return template?.durationMin ?? 150; // Default 2.5h domestic
}

// Estimate aircraft type for a carrier on a route
function estimateAircraft(origin: string, dest: string, carrier: string, isRegional: boolean): AircraftType {
  if (isRegional) {
    return AIRCRAFT_TYPES['E175'] || AIRCRAFT_TYPES['CRJ900'];
  }

  // Look up typical aircraft for this carrier/route from schedule templates
  const template = SCHEDULE_TEMPLATES.find(
    t => t.origin === origin && t.destination === dest && t.carrier === carrier
  );
  if (template) {
    // Pick the most common aircraft type from the template
    const typeCounts = new Map<string, number>();
    for (const ac of template.aircraft) {
      typeCounts.set(ac, (typeCounts.get(ac) || 0) + 1);
    }
    let mostCommon = template.aircraft[0];
    let maxCount = 0;
    for (const [type, count] of typeCounts) {
      if (count > maxCount) {
        mostCommon = type;
        maxCount = count;
      }
    }
    return AIRCRAFT_TYPES[mostCommon] || AIRCRAFT_TYPES['B737'];
  }

  // Default by carrier
  const carrierDefaults: Record<string, string> = {
    'DL': 'B737',
    'AA': 'A321',
    'UA': 'B737MAX',
    'WN': 'B737MAX',
    'B6': 'A320',
    'NK': 'A320',
    'F9': 'A320',
    'AS': 'B737',
  };
  return AIRCRAFT_TYPES[carrierDefaults[carrier] || 'B737'] || AIRCRAFT_TYPES['B737'];
}

// Score a single flight (shared logic for both OpenSky and template flights)
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
    carrier: carrierCode,
    depTime,
    aircraft,
    origin,
    date,
    dayOfWeek,
    baseRouteLF,
    isPeakDay,
    isLeisureRoute,
    originWx,
    destWx,
  } = params;

  const carrier = CARRIER_STATS[carrierCode];
  if (!carrier) return { score: 25, factors: [], effectiveLF: baseRouteLF };

  let score = 25; // Base probability
  const factors: string[] = [];

  // 1. Carrier Historical DB Rate (0-15 points)
  const carrierScore = Math.min(15, Math.round(carrier.dbRate * 12));
  score += carrierScore;
  if (carrierScore >= 8) {
    factors.push(`${carrier.name} high DB rate (${carrier.dbRate}/10k)`);
  }

  // 2. Route Load Factor (0-20 points)
  let effectiveLF = baseRouteLF;
  if (isPeakDay) effectiveLF = Math.min(0.98, effectiveLF + 0.04);
  const lfScore = Math.max(0, Math.min(20, Math.round((effectiveLF - 0.80) * 133)));
  score += lfScore;
  if (effectiveLF >= 0.88) {
    factors.push(`High load factor (${Math.round(effectiveLF * 100)}%)`);
  }

  // 3. Day of Week (0-15 points)
  if (dayOfWeek === 1 || dayOfWeek === 4 || dayOfWeek === 5) {
    score += 15;
    factors.push('Peak business travel day');
  } else if (dayOfWeek === 0) {
    score += 10;
    factors.push('Sunday return travel surge');
  } else if (dayOfWeek === 6) {
    if (isLeisureRoute) {
      score += 12;
      factors.push('Weekend leisure route demand');
    }
  } else {
    score += 2;
  }

  // 4. Time of Day (0-15 points)
  const depMinutes = getTimeMinutes(depTime);
  if (depMinutes >= 1080) { // 18:00+
    score += 15;
    factors.push('Last bank of the day');
  } else if (depMinutes >= 960) { // 16:00-18:00
    score += 12;
    factors.push('Late afternoon departure');
  } else if (depMinutes <= 480) { // Before 8:00
    score += 10;
    factors.push('Early morning business rush');
  } else if (depMinutes <= 600) { // 8:00-10:00
    score += 8;
    factors.push('Morning peak departure');
  } else {
    score += 3; // Midday
  }

  // 5. Aircraft Type (0-20 points)
  if (aircraft.isRegional) {
    score += 20;
    factors.push(`Regional jet (${aircraft.name}, ${aircraft.capacity} seats)`);
  } else if (aircraft.capacity <= 140) {
    score += 12;
    factors.push(`Small narrowbody (${aircraft.name}, ${aircraft.capacity} seats)`);
  } else if (aircraft.capacity <= 180) {
    score += 8;
    factors.push(`Standard narrowbody (${aircraft.capacity} seats)`);
  } else if (aircraft.capacity <= 200) {
    score += 4;
  }

  // 6. Weather Disruptions (0-25 points each)
  if (originWx.score > 0 && originWx.reason) {
    score += originWx.score;
    factors.push(`Origin: ${originWx.reason}`);
  }
  if (destWx.score > 0 && destWx.reason) {
    score += Math.round(destWx.score * 0.6);
    factors.push(`Destination: ${destWx.reason}`);
  }

  // 7. Seasonal/Holiday (0-10 points)
  if (isHolidayPeriod(date)) {
    score += 10;
    factors.push('Holiday travel period');
  } else if (isSummerPeak(date)) {
    score += 5;
    factors.push('Summer peak season');
  }

  // 8. Fortress Hub bonus
  if (carrierCode === 'DL' && origin === 'ATL') {
    score += 5;
    factors.push('Delta fortress hub dynamics');
  } else if (carrierCode === 'AA' && (origin === 'DFW' || origin === 'CLT')) {
    score += 5;
    factors.push('American fortress hub dynamics');
  } else if (carrierCode === 'UA' && (origin === 'EWR' || origin === 'ORD' || origin === 'DEN')) {
    score += 5;
    factors.push('United fortress hub dynamics');
  }

  score = Math.min(98, Math.max(5, score));
  return { score, factors, effectiveLF };
}

// =============================================================================
// Score flights using REAL OpenSky data + fallback to schedule templates
// =============================================================================

export async function scoreFlights(
  origin: string,
  dest: string,
  dateStr: string
): Promise<ScoredFlight[]> {
  const originUpper = origin.toUpperCase();
  const destUpper = dest.toUpperCase();
  const date = dateStr ? new Date(dateStr + 'T12:00:00') : new Date();
  const dayOfWeek = date.getDay();

  // Look up route-specific load factor
  const routeLF = ROUTE_LOAD_FACTORS.find(
    r => (r.origin === originUpper && r.dest === destUpper) ||
         (r.origin === destUpper && r.dest === originUpper)
  );
  const baseRouteLF = routeLF?.loadFactor ?? 0.83;
  const isPeakDay = routeLF?.peakDays.includes(dayOfWeek) ?? false;
  const isLeisureRoute = routeLF?.isLeisure ?? false;

  // Fetch live weather for both airports in parallel
  const [originWx, destWx] = await Promise.all([
    getWeatherSeverity(originUpper),
    getWeatherSeverity(destUpper),
  ]);

  // ===== Try OpenSky real data first =====
  let realFlights: RealFlight[] = [];
  try {
    realFlights = await getFlightsForRoute(originUpper, destUpper, dateStr);
    console.log(`[Scoring] Got ${realFlights.length} real flights from OpenSky for ${originUpper}→${destUpper}`);
  } catch (err) {
    console.warn(`[Scoring] OpenSky fetch failed, falling back to templates:`, err);
  }

  // Determine which carriers serve this route (from schedule templates)
  const routeCarriers = new Set<string>();
  for (const t of SCHEDULE_TEMPLATES) {
    if (t.origin === originUpper && t.destination === destUpper) {
      routeCarriers.add(t.carrier);
    }
  }

  const flights: ScoredFlight[] = [];

  // ===== Process real OpenSky flights =====
  if (realFlights.length > 0) {
    // Filter: only include flights from carriers known to serve this route
    const routeFlights = realFlights.filter(f => routeCarriers.has(f.carrierCode));

    // If we have confirmed flights (cross-referenced departures+arrivals), use only those
    const confirmedFlights = routeFlights.filter(f => f.confirmed);
    const flightsToScore = confirmedFlights.length >= 2 ? confirmedFlights : routeFlights;

    console.log(`[Scoring] Using ${flightsToScore.length} flights (${confirmedFlights.length} confirmed) for ${originUpper}→${destUpper}`);

    for (const rf of flightsToScore) {
      const aircraft = estimateAircraft(originUpper, destUpper, rf.carrierCode, rf.isRegional);
      const durationMin = estimateDuration(originUpper, destUpper, rf.carrierCode);
      const arrTime = addMinutes(rf.departureTime, durationMin);

      const { score, factors, effectiveLF } = computeBumpScore({
        carrier: rf.carrierCode,
        depTime: rf.departureTime,
        aircraft,
        origin: originUpper,
        dest: destUpper,
        date,
        dayOfWeek,
        baseRouteLF,
        isPeakDay,
        isLeisureRoute,
        originWx,
        destWx,
      });

      const carrierStats = CARRIER_STATS[rf.carrierCode];

      flights.push({
        id: `${rf.callsign}-${dateStr}`,
        airline: rf.carrierName,
        carrier: rf.carrierCode,
        flightNumber: rf.flightNumber,
        departure: originUpper,
        arrival: destUpper,
        depTime: rf.departureTime,
        arrTime,
        aircraft: aircraft.name,
        aircraftCode: aircraft.iataCode,
        capacity: aircraft.capacity,
        isRegional: rf.isRegional || aircraft.isRegional,
        bumpScore: score,
        factors,
        loadFactor: effectiveLF,
        carrierDbRate: carrierStats?.dbRate ?? 0.5,
        dataSource: 'opensky',
      });
    }
  }

  // ===== Fallback: use schedule templates if OpenSky gave us too few flights =====
  if (flights.length < 3) {
    console.log(`[Scoring] Only ${flights.length} OpenSky flights, supplementing with schedule templates`);

    const templates = SCHEDULE_TEMPLATES.filter(
      t => t.origin === originUpper && t.destination === destUpper
    );

    // Track OpenSky flight times to avoid duplicates
    const existingTimes = new Set(flights.map(f => `${f.carrier}-${f.depTime}`));

    for (const template of templates) {
      const carrier = CARRIER_STATS[template.carrier];
      if (!carrier) continue;

      if (template.daysOfWeek && !template.daysOfWeek.includes(dayOfWeek)) {
        continue;
      }

      for (let i = 0; i < template.departures.length; i++) {
        const depTime = template.departures[i];
        const timeKey = `${template.carrier}-${depTime}`;

        // Skip if we already have an OpenSky flight at a similar time for this carrier
        if (existingTimes.has(timeKey)) continue;

        const aircraftKey = template.aircraft[i] || template.aircraft[0];
        const aircraft = AIRCRAFT_TYPES[aircraftKey] || AIRCRAFT_TYPES['B737'];

        const { score, factors, effectiveLF } = computeBumpScore({
          carrier: template.carrier,
          depTime,
          aircraft,
          origin: originUpper,
          dest: destUpper,
          date,
          dayOfWeek,
          baseRouteLF,
          isPeakDay,
          isLeisureRoute,
          originWx,
          destWx,
        });

        const flightNum = template.flightNumBase + i;
        const arrTime = addMinutes(depTime, template.durationMin);

        flights.push({
          id: `${template.carrier}${flightNum}-${dateStr}`,
          airline: template.carrierName,
          carrier: template.carrier,
          flightNumber: `${template.carrier} ${flightNum}`,
          departure: originUpper,
          arrival: destUpper,
          depTime,
          arrTime,
          aircraft: aircraft.name,
          aircraftCode: aircraftKey,
          capacity: aircraft.capacity,
          isRegional: aircraft.isRegional,
          bumpScore: score,
          factors,
          loadFactor: effectiveLF,
          carrierDbRate: carrier.dbRate,
          dataSource: 'schedule',
        });
      }
    }
  }

  // Sort by bump score descending
  flights.sort((a, b) => b.bumpScore - a.bumpScore);
  return flights;
}
