import { cacheGet, cacheSet } from './cache.js';

// =============================================================================
// FAA Airport Status — Ground Delay Programs, Ground Stops, Closures
//
// Source: FAA NASSTATUS (National Airspace System Status)
// Endpoint: https://nasstatus.faa.gov/api/airport-status-information
// Returns XML with current GDP, Ground Stop, and Closure information.
// Free, no API key required.
// =============================================================================

const FAA_STATUS_URL = 'https://nasstatus.faa.gov/api/airport-status-information';
const FAA_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const FAA_CACHE_KEY = 'faa:status:all';

export interface FAAStatus {
  airport: string;
  delay: boolean;
  delayType?: 'GDP' | 'GS' | 'CLOSURE' | 'DELAY';
  reason?: string;
  avgDelay?: string;
}

// Internal parsed structure for the full FAA feed
interface FAAFeedData {
  groundDelays: Array<{ airport: string; reason: string; avg: string; max: string }>;
  groundStops: Array<{ airport: string; reason: string; endTime: string }>;
  closures: Array<{ airport: string; reason: string; start: string; reopen: string }>;
  generalDelays: Array<{ airport: string; reason: string; type: string; trend: string; min: string; max: string }>;
  fetchedAt: number;
}

// =============================================================================
// XML parsing helpers — simple regex-based extraction (no dependency needed)
// =============================================================================

function extractAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}>(.*?)</${tag}>`, 'gs');
  const results: string[] = [];
  let match;
  while ((match = re.exec(xml)) !== null) {
    results.push(match[1]);
  }
  return results;
}

function extractOne(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>(.*?)</${tag}>`, 's');
  const match = re.exec(xml);
  return match ? match[1].trim() : null;
}

function parseFAAFeed(xml: string): FAAFeedData {
  const data: FAAFeedData = {
    groundDelays: [],
    groundStops: [],
    closures: [],
    generalDelays: [],
    fetchedAt: Date.now(),
  };

  // Parse each Delay_type block
  const delayTypeBlocks = extractAll(xml, 'Delay_type');

  for (const block of delayTypeBlocks) {
    const name = extractOne(block, 'Name') || '';

    if (name === 'Ground Delay Programs') {
      const delays = extractAll(block, 'Ground_Delay');
      for (const d of delays) {
        data.groundDelays.push({
          airport: extractOne(d, 'ARPT') || '',
          reason: extractOne(d, 'Reason') || '',
          avg: extractOne(d, 'Avg') || '',
          max: extractOne(d, 'Max') || '',
        });
      }
    } else if (name === 'Ground Stops') {
      const stops = extractAll(block, 'Program');
      for (const s of stops) {
        data.groundStops.push({
          airport: extractOne(s, 'ARPT') || '',
          reason: extractOne(s, 'Reason') || '',
          endTime: extractOne(s, 'End_Time') || '',
        });
      }
    } else if (name === 'Airport Closures') {
      const airports = extractAll(block, 'Airport');
      for (const a of airports) {
        data.closures.push({
          airport: extractOne(a, 'ARPT') || '',
          reason: extractOne(a, 'Reason') || '',
          start: extractOne(a, 'Start') || '',
          reopen: extractOne(a, 'Reopen') || '',
        });
      }
    } else if (name === 'Arrival/Departure Delay' || name.includes('Delay')) {
      // General arrival/departure delays
      const delays = extractAll(block, 'Delay');
      for (const d of delays) {
        data.generalDelays.push({
          airport: extractOne(d, 'ARPT') || '',
          reason: extractOne(d, 'Reason') || '',
          type: extractOne(d, 'Type') || '',
          trend: extractOne(d, 'Trend') || '',
          min: extractOne(d, 'Min') || '',
          max: extractOne(d, 'Max') || '',
        });
      }
    }
  }

  return data;
}

// =============================================================================
// Fetch and cache the full FAA status feed
// =============================================================================

async function fetchFAAFeed(): Promise<FAAFeedData | null> {
  const cached = cacheGet<FAAFeedData>(FAA_CACHE_KEY);
  if (cached) return cached;

  try {
    const res = await fetch(FAA_STATUS_URL, {
      headers: { 'Accept': 'application/xml, text/xml, */*' },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      console.warn(`[FAA] Status fetch failed: ${res.status} ${res.statusText}`);
      return null;
    }

    const xml = await res.text();

    // Basic sanity check — make sure it looks like the expected XML
    if (!xml.includes('AIRPORT_STATUS_INFORMATION')) {
      console.warn('[FAA] Unexpected response format');
      return null;
    }

    const data = parseFAAFeed(xml);
    cacheSet(FAA_CACHE_KEY, data, FAA_CACHE_TTL);
    return data;
  } catch (err) {
    console.warn('[FAA] Fetch error:', err);
    return null;
  }
}

// =============================================================================
// Public API: get status for a specific airport
// =============================================================================

export async function getAirportStatus(iata: string): Promise<FAAStatus | null> {
  const airport = iata.toUpperCase();

  const feed = await fetchFAAFeed();
  if (!feed) {
    // FAA down — return no-delay status (graceful degradation)
    return { airport, delay: false };
  }

  // Check Ground Stops first (most severe)
  const gs = feed.groundStops.find(s => s.airport === airport);
  if (gs) {
    return {
      airport,
      delay: true,
      delayType: 'GS',
      reason: gs.reason || 'Ground Stop',
      avgDelay: gs.endTime ? `until ${gs.endTime}` : undefined,
    };
  }

  // Check Ground Delay Programs
  const gdp = feed.groundDelays.find(d => d.airport === airport);
  if (gdp) {
    return {
      airport,
      delay: true,
      delayType: 'GDP',
      reason: gdp.reason || 'Ground Delay Program',
      avgDelay: gdp.avg || undefined,
    };
  }

  // Check Closures
  const closure = feed.closures.find(c => c.airport === airport);
  if (closure) {
    return {
      airport,
      delay: true,
      delayType: 'CLOSURE',
      reason: closure.reason || 'Airport Closure',
      avgDelay: closure.reopen ? `reopens ${closure.reopen}` : undefined,
    };
  }

  // Check general arrival/departure delays
  const genDelay = feed.generalDelays.find(d => d.airport === airport);
  if (genDelay) {
    const avgDelay = genDelay.min && genDelay.max
      ? `${genDelay.min} - ${genDelay.max}`
      : genDelay.min || genDelay.max || undefined;
    return {
      airport,
      delay: true,
      delayType: 'DELAY',
      reason: genDelay.reason || 'General Delays',
      avgDelay,
    };
  }

  // No delays for this airport
  return { airport, delay: false };
}

// =============================================================================
// Bulk: get all airports with active delays (for scoring integration)
// =============================================================================

export async function getAllActiveDelays(): Promise<Map<string, FAAStatus>> {
  const map = new Map<string, FAAStatus>();

  const feed = await fetchFAAFeed();
  if (!feed) return map;

  for (const gs of feed.groundStops) {
    map.set(gs.airport, {
      airport: gs.airport,
      delay: true,
      delayType: 'GS',
      reason: gs.reason || 'Ground Stop',
      avgDelay: gs.endTime ? `until ${gs.endTime}` : undefined,
    });
  }

  for (const gdp of feed.groundDelays) {
    if (!map.has(gdp.airport)) {
      map.set(gdp.airport, {
        airport: gdp.airport,
        delay: true,
        delayType: 'GDP',
        reason: gdp.reason || 'Ground Delay Program',
        avgDelay: gdp.avg || undefined,
      });
    }
  }

  for (const closure of feed.closures) {
    if (!map.has(closure.airport)) {
      map.set(closure.airport, {
        airport: closure.airport,
        delay: true,
        delayType: 'CLOSURE',
        reason: closure.reason || 'Airport Closure',
        avgDelay: closure.reopen ? `reopens ${closure.reopen}` : undefined,
      });
    }
  }

  for (const delay of feed.generalDelays) {
    if (!map.has(delay.airport)) {
      const avgDelay = delay.min && delay.max
        ? `${delay.min} - ${delay.max}`
        : delay.min || delay.max || undefined;
      map.set(delay.airport, {
        airport: delay.airport,
        delay: true,
        delayType: 'DELAY',
        reason: delay.reason || 'General Delays',
        avgDelay,
      });
    }
  }

  return map;
}
