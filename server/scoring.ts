import {
  CARRIER_STATS,
  ROUTE_LOAD_FACTORS,
  AIRCRAFT_TYPES,
  SCHEDULE_TEMPLATES,
  type ScheduleTemplate,
  type AircraftType,
} from './data.js';
import { getWeatherSeverity } from './weather.js';

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

export async function scoreFlights(
  origin: string,
  dest: string,
  dateStr: string
): Promise<ScoredFlight[]> {
  const originUpper = origin.toUpperCase();
  const destUpper = dest.toUpperCase();
  const date = dateStr ? new Date(dateStr + 'T12:00:00') : new Date();
  const dayOfWeek = date.getDay(); // 0=Sun ... 6=Sat

  // Find matching schedule templates
  const templates = SCHEDULE_TEMPLATES.filter(
    t => t.origin === originUpper && t.destination === destUpper
  );

  if (templates.length === 0) {
    return [];
  }

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

  const flights: ScoredFlight[] = [];

  for (const template of templates) {
    const carrier = CARRIER_STATS[template.carrier];
    if (!carrier) continue;

    // Check day-of-week filter if specified
    if (template.daysOfWeek && !template.daysOfWeek.includes(dayOfWeek)) {
      continue;
    }

    for (let i = 0; i < template.departures.length; i++) {
      const depTime = template.departures[i];
      const aircraftKey = template.aircraft[i] || template.aircraft[0];
      const aircraft = AIRCRAFT_TYPES[aircraftKey] || AIRCRAFT_TYPES['B737'];

      // --- Scoring ---
      let score = 25; // Base probability
      const factors: string[] = [];

      // 1. Carrier Historical DB Rate (0-15 points)
      // Normalize: Delta (0.17) → ~2pts, Frontier (1.23) → 15pts
      const carrierScore = Math.min(15, Math.round(carrier.dbRate * 12));
      score += carrierScore;
      if (carrierScore >= 8) {
        factors.push(`${carrier.name} high DB rate (${carrier.dbRate}/10k)`);
      }

      // 2. Route Load Factor (0-20 points)
      // Adjust LF for peak days
      let effectiveLF = baseRouteLF;
      if (isPeakDay) effectiveLF = Math.min(0.98, effectiveLF + 0.04);
      // Normalize: 80% → 0pts, 95% → 20pts
      const lfScore = Math.max(0, Math.min(20, Math.round((effectiveLF - 0.80) * 133)));
      score += lfScore;
      if (effectiveLF >= 0.88) {
        factors.push(`High load factor (${Math.round(effectiveLF * 100)}%)`);
      }

      // 3. Day of Week (0-15 points)
      if (dayOfWeek === 1 || dayOfWeek === 4 || dayOfWeek === 5) {
        // Monday, Thursday, Friday - peak business
        score += 15;
        factors.push('Peak business travel day');
      } else if (dayOfWeek === 0) {
        // Sunday - return travel
        score += 10;
        factors.push('Sunday return travel surge');
      } else if (dayOfWeek === 6) {
        // Saturday - depends on route type
        if (isLeisureRoute) {
          score += 12;
          factors.push('Weekend leisure route demand');
        }
      } else {
        // Tue, Wed - lowest demand
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
      // Widebody (200+) gets 0 extra points

      // 6. Weather Disruptions (0-25 points each)
      if (originWx.score > 0 && originWx.reason) {
        score += originWx.score;
        factors.push(`Origin: ${originWx.reason}`);
      }
      if (destWx.score > 0 && destWx.reason) {
        score += Math.round(destWx.score * 0.6); // Destination weather has less impact
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

      // 8. Fortress Hub bonus (carrier dominance at hub)
      if (template.carrier === 'DL' && originUpper === 'ATL') {
        score += 5;
        factors.push('Delta fortress hub dynamics');
      } else if (template.carrier === 'AA' && (originUpper === 'DFW' || originUpper === 'CLT')) {
        score += 5;
        factors.push('American fortress hub dynamics');
      } else if (template.carrier === 'UA' && (originUpper === 'EWR' || originUpper === 'ORD' || originUpper === 'DEN')) {
        score += 5;
        factors.push('United fortress hub dynamics');
      }

      // Cap score at 98
      score = Math.min(98, Math.max(5, score));

      // Generate a deterministic but realistic flight number
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
      });
    }
  }

  // Sort by bump score descending
  flights.sort((a, b) => b.bumpScore - a.bumpScore);
  return flights;
}
