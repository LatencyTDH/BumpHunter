// =============================================================================
// DOT Compensation Calculator — 14 CFR 250.5
//
// Calculates estimated DOT-mandated minimum compensation when involuntarily
// denied boarding. Passengers can DEMAND cash (airlines push vouchers).
//
// Domestic flight rules:
//   - Arrive 0-1hr late: no compensation
//   - Arrive 1-2hr late: 200% one-way fare (max $775)
//   - Arrive 2+hr late: 400% one-way fare (max $1,550)
//
// We estimate:
//   1. Next available flight on same route (from schedule data)
//   2. Rebooking delay in hours
//   3. Compensation tier (200% or 400%)
//   4. Fare estimate based on route distance
// =============================================================================

// =============================================================================
// Route distances (statute miles) for fare estimation
// =============================================================================

const ROUTE_DISTANCES: Record<string, number> = {
  'ATL-LGA': 762, 'ATL-JFK': 760, 'ATL-ORD': 606, 'ATL-DFW': 731,
  'ATL-MCO': 403, 'ATL-EWR': 746, 'ATL-DEN': 1199, 'ATL-LAS': 1747,
  'ATL-CLT': 226, 'ATL-BOS': 946, 'ATL-DCA': 547, 'ATL-LAX': 1946,
  'ATL-SFO': 2139, 'ATL-MIA': 594, 'ATL-SEA': 2182,
  'DFW-ORD': 802, 'DFW-LGA': 1389, 'DFW-EWR': 1372, 'DFW-LAS': 1055,
  'DFW-DEN': 641, 'DFW-MCO': 984, 'DFW-LAX': 1235, 'DFW-MIA': 1121,
  'DFW-JFK': 1391, 'DFW-SFO': 1464, 'DFW-PHX': 868, 'DFW-CLT': 936,
  'EWR-ORD': 719, 'EWR-DEN': 1605, 'EWR-LAS': 2227, 'EWR-LAX': 2454,
  'EWR-SFO': 2565, 'EWR-MCO': 937, 'EWR-MIA': 1085, 'EWR-BOS': 200,
  'EWR-CLT': 529, 'ORD-LGA': 733, 'ORD-DEN': 888, 'ORD-LAS': 1514,
  'ORD-DFW': 802, 'ORD-LAX': 1745, 'ORD-SFO': 1846, 'ORD-MCO': 1005,
  'ORD-MIA': 1197, 'ORD-JFK': 740, 'ORD-BOS': 867, 'ORD-DCA': 612,
  'ORD-SEA': 1721, 'ORD-MSP': 334, 'DEN-LAS': 628, 'DEN-ORD': 888,
  'DEN-LGA': 1619, 'DEN-LAX': 862, 'DEN-SFO': 967, 'DEN-DFW': 641,
  'DEN-PHX': 602, 'DEN-SEA': 1024, 'DEN-MSP': 680, 'LGA-DCA': 214,
  'LGA-BOS': 185, 'LGA-CLT': 544, 'LGA-MIA': 1096, 'LGA-MCO': 950,
  'JFK-LAX': 2475, 'JFK-SFO': 2586, 'JFK-MCO': 944, 'JFK-MIA': 1090,
  'CLT-LGA': 544, 'CLT-EWR': 529, 'CLT-ORD': 599, 'CLT-DFW': 936,
  'CLT-BOS': 728, 'CLT-MCO': 468, 'CLT-MIA': 650, 'CLT-DCA': 330,
  'MCO-EWR': 937, 'MCO-ORD': 1005, 'MCO-DFW': 984, 'MCO-LGA': 950,
  'MCO-JFK': 944, 'MCO-CLT': 468, 'MCO-BOS': 1122,
  'LAS-LAX': 236, 'LAS-DEN': 628, 'LAS-DFW': 1055, 'LAS-ORD': 1514,
  'LAS-SFO': 414, 'LAS-EWR': 2227, 'LAS-PHX': 256,
};

// =============================================================================
// Types
// =============================================================================

export type CompensationTier = 'none' | '200pct' | '400pct';

export type CompensationEstimate = {
  /** Whether this is the last flight of the day on this route */
  lastFlightOfDay: boolean;
  /** Departure time of the next flight on this route (null if last flight) */
  nextFlightDepTime: string | null;
  /** Estimated rebooking delay in hours */
  rebookingDelayHours: number;
  /** DOT compensation tier */
  tier: CompensationTier;
  /** Human-readable tier label */
  tierLabel: string;
  /** DOT maximum for this tier */
  maxCompensation: number;
  /** Estimated fare-based compensation (200% or 400% of one-way fare) */
  estimatedCompensation: number;
  /** Human-readable compensation string */
  compensationDisplay: string;
  /** Explanation for the user */
  explanation: string;
};

// =============================================================================
// Core functions
// =============================================================================

/**
 * Get the distance for a route in statute miles.
 * Tries both origin-dest and dest-origin keys.
 */
export function getRouteDistance(origin: string, dest: string): number {
  return ROUTE_DISTANCES[`${origin}-${dest}`]
    ?? ROUTE_DISTANCES[`${dest}-${origin}`]
    ?? 800; // reasonable default for unknown routes
}

/**
 * Estimate one-way fare based on route distance.
 * Uses ~$0.11/mile average (DOT industry data).
 * Floors at $100 for very short routes.
 */
export function estimateFare(origin: string, dest: string): number {
  const distance = getRouteDistance(origin, dest);
  return Math.max(100, Math.round(distance * 0.11));
}

/**
 * Parse "HH:MM" to minutes since midnight.
 */
function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + (m || 0);
}

/**
 * Determine if a flight is the last flight of the day on this route.
 *
 * @param depTime - Departure time of the flight being checked ("HH:MM")
 * @param allRouteFlightTimes - ALL departure times on the same origin→dest route for the day
 * @returns true if no later flight exists on this route today
 */
export function isLastFlightOfDay(
  depTime: string,
  allRouteFlightTimes: string[],
): boolean {
  const thisMinutes = timeToMinutes(depTime);

  for (const t of allRouteFlightTimes) {
    const otherMinutes = timeToMinutes(t);
    if (otherMinutes > thisMinutes) {
      return false; // There's a later flight
    }
  }
  return true;
}

/**
 * Find the next flight departure time on the same route after a given time.
 * Returns null if this is the last flight of the day.
 */
export function findNextFlightTime(
  depTime: string,
  allRouteFlightTimes: string[],
): string | null {
  const thisMinutes = timeToMinutes(depTime);
  let closestTime: string | null = null;
  let closestDiff = Infinity;

  for (const t of allRouteFlightTimes) {
    const otherMinutes = timeToMinutes(t);
    const diff = otherMinutes - thisMinutes;
    if (diff > 0 && diff < closestDiff) {
      closestDiff = diff;
      closestTime = t;
    }
  }

  return closestTime;
}

/**
 * Calculate the rebooking delay in hours.
 *
 * If there's a next flight today: delay = next flight arrival time - original arrival time.
 * If last flight of day: assume next flight is same time tomorrow = ~24 hours.
 *
 * @param depTime - This flight's departure time
 * @param nextFlightDepTime - Next available flight's dep time (null = last flight)
 * @param flightDurationMin - Estimated flight duration in minutes
 */
export function calculateRebookingDelay(
  depTime: string,
  nextFlightDepTime: string | null,
  flightDurationMin: number,
): number {
  if (!nextFlightDepTime) {
    // Last flight of day — next available is ~tomorrow morning or same time
    // Conservative: 24hr delay (could be less, but DOT uses arrival delay)
    return 24;
  }

  const thisArrival = timeToMinutes(depTime) + flightDurationMin;
  const nextArrival = timeToMinutes(nextFlightDepTime) + flightDurationMin;
  const delayMinutes = nextArrival - thisArrival;

  return Math.max(0, delayMinutes / 60);
}

/**
 * Determine DOT compensation tier based on rebooking delay.
 * 14 CFR 250.5 — domestic flights:
 *   0-1 hr: no compensation
 *   1-2 hr: 200% of one-way fare (max $775)
 *   2+ hr:  400% of one-way fare (max $1,550)
 */
export function getCompensationTier(delayHours: number): {
  tier: CompensationTier;
  multiplier: number;
  maxAmount: number;
  label: string;
} {
  if (delayHours < 1) {
    return { tier: 'none', multiplier: 0, maxAmount: 0, label: 'No compensation (< 1hr delay)' };
  }
  if (delayHours < 2) {
    return { tier: '200pct', multiplier: 2, maxAmount: 775, label: '200% rule (1-2hr delay)' };
  }
  return { tier: '400pct', multiplier: 4, maxAmount: 1550, label: '400% rule (2+hr delay)' };
}

/**
 * Full compensation estimate for a flight.
 *
 * @param origin - Origin airport code
 * @param dest - Destination airport code
 * @param depTime - This flight's departure time ("HH:MM")
 * @param allRouteFlightTimes - All departure times on this route for the day
 * @param flightDurationMin - Estimated flight duration in minutes
 */
export function calculateCompensation(
  origin: string,
  dest: string,
  depTime: string,
  allRouteFlightTimes: string[],
  flightDurationMin: number,
): CompensationEstimate {
  const lastFlight = isLastFlightOfDay(depTime, allRouteFlightTimes);
  const nextFlightDep = findNextFlightTime(depTime, allRouteFlightTimes);
  const delayHours = calculateRebookingDelay(depTime, nextFlightDep, flightDurationMin);
  const { tier, multiplier, maxAmount, label } = getCompensationTier(delayHours);

  const fare = estimateFare(origin, dest);
  const fareBased = multiplier * fare;
  const estimatedComp = Math.min(fareBased, maxAmount);

  let compensationDisplay: string;
  let explanation: string;

  if (tier === 'none') {
    compensationDisplay = 'No DOT compensation';
    explanation = `Next flight departs at ${nextFlightDep} — arrival delay under 1 hour.`;
  } else if (lastFlight) {
    compensationDisplay = `Up to $${maxAmount.toLocaleString()}`;
    explanation = `Last flight of day — next flight tomorrow. ${label}. DOT max: $${maxAmount.toLocaleString()}.`;
  } else {
    compensationDisplay = `Up to $${maxAmount.toLocaleString()}`;
    const delayStr = delayHours >= 1 ? `${Math.round(delayHours)}hr` : `${Math.round(delayHours * 60)}min`;
    explanation = `Next flight at ${nextFlightDep} (~${delayStr} delay). ${label}. DOT max: $${maxAmount.toLocaleString()}.`;
  }

  return {
    lastFlightOfDay: lastFlight,
    nextFlightDepTime: nextFlightDep,
    rebookingDelayHours: Math.round(delayHours * 10) / 10,
    tier,
    tierLabel: label,
    maxCompensation: maxAmount,
    estimatedCompensation: estimatedComp,
    compensationDisplay,
    explanation,
  };
}
