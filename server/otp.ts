import { cacheGet, cacheSet } from './cache.js';

// =============================================================================
// BTS On-Time Performance (Route Reliability)
//
// Source: BTS Airline On-Time Statistics (transtats.bts.gov)
// Summary endpoint: https://transtats.bts.gov/ONTIME/OriginDestination.aspx
// Uses a 12-month window ending with the most recent published month.
// =============================================================================

const OTP_URL = 'https://transtats.bts.gov/ONTIME/OriginDestination.aspx';
const OTP_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const OTP_SOURCE = 'BTS On-Time (transtats.bts.gov)';

// BTS page indicates data available through Nov 2025 as of last update.
// Update when BTS publishes newer months.
const OTP_LATEST_AVAILABLE = { year: 2025, month: 11 }; // Month is 1-12

export type RouteReliability = {
  origin: string;
  dest: string;
  delayPct: number | null;
  totalFlights: number | null;
  periodLabel: string;
  source: string;
  available: boolean;
  message?: string;
};

function formatMonthYear(date: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const m = months[date.getUTCMonth()];
  return `${m} ${date.getUTCFullYear()}`;
}

function buildOtpPeriod() {
  const end = new Date(Date.UTC(OTP_LATEST_AVAILABLE.year, OTP_LATEST_AVAILABLE.month, 0));
  const start = new Date(Date.UTC(OTP_LATEST_AVAILABLE.year - 1, OTP_LATEST_AVAILABLE.month, 1));
  const label = `${formatMonthYear(start)}–${formatMonthYear(end)}`;
  return { start, end, label };
}

function dateParts(date: Date) {
  return {
    month: String(date.getUTCMonth() + 1),
    day: String(date.getUTCDate()),
    year: String(date.getUTCFullYear()),
  };
}

function extractHidden(html: string, name: string): string | null {
  const match = html.match(new RegExp(`name=\"${name}\"[^>]*value=\"([^\"]*)\"`, 'i'));
  return match ? match[1] : null;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractRowCells(tableHtml: string, rowLabel: string): string[] | null {
  const rowRe = new RegExp(`<tr[^>]*>\\s*<td[^>]*>${escapeRegex(rowLabel)}<\\/td>[\\s\\S]*?<\\/tr>`, 'i');
  const rowMatch = tableHtml.match(rowRe);
  if (!rowMatch) return null;
  const cells = rowMatch[0].match(/<td[^>]*>[\s\S]*?<\/td>/gi);
  if (!cells) return null;
  return cells.map(cell => stripTags(cell));
}

export function parseOtpStats(html: string): { delayPct: number | null; totalFlights: number | null } {
  let delayPct: number | null = null;
  let totalFlights: number | null = null;

  const tables = html.match(/<table[^>]*>[\s\S]*?<\/table>/gi) || [];

  const lateTable = tables.find(table => /Percent Flights Late/i.test(table));
  if (lateTable) {
    const cells = extractRowCells(lateTable, 'ALL*');
    if (cells && cells.length > 0) {
      const last = cells[cells.length - 1].replace(/,/g, '');
      const parsed = parseFloat(last);
      delayPct = Number.isFinite(parsed) ? parsed : null;
    }
  }

  const totalsTable = tables.find(table => /Total Flights/i.test(table));
  if (totalsTable) {
    const cells = extractRowCells(totalsTable, 'ALL*');
    if (cells && cells.length >= 2) {
      const parsed = parseInt(cells[1].replace(/,/g, ''), 10);
      totalFlights = Number.isFinite(parsed) ? parsed : null;
    }
  }

  return { delayPct, totalFlights };
}

async function fetchOtpHtml(origin: string, dest: string, period: { start: Date; end: Date }): Promise<string | null> {
  try {
    const res = await fetch(OTP_URL, {
      headers: { 'User-Agent': 'BumpHunter/1.0', 'Accept': 'text/html' },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      console.warn(`[OTP] Form fetch failed: ${res.status} ${res.statusText}`);
      return null;
    }

    const html = await res.text();
    const viewState = extractHidden(html, '__VIEWSTATE');
    const viewStateGen = extractHidden(html, '__VIEWSTATEGENERATOR');
    const eventValidation = extractHidden(html, '__EVENTVALIDATION');

    if (!viewState || !viewStateGen || !eventValidation) {
      console.warn('[OTP] Missing hidden form fields');
      return null;
    }

    const start = dateParts(period.start);
    const end = dateParts(period.end);

    const params = new URLSearchParams({
      '__VIEWSTATE': viewState,
      '__VIEWSTATEGENERATOR': viewStateGen,
      '__EVENTVALIDATION': eventValidation,
      'cboAirport_Origin': origin,
      'cboAirport_Dest': dest,
      'stdatemon': start.month,
      'stdateday': start.day,
      'stdateyear': start.year,
      'eddatemon': end.month,
      'eddateday': end.day,
      'eddateyear': end.year,
      'btnSubmit': 'Submit',
    });

    const post = await fetch(OTP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'BumpHunter/1.0',
      },
      body: params.toString(),
      signal: AbortSignal.timeout(20000),
    });

    if (!post.ok) {
      console.warn(`[OTP] Query failed: ${post.status} ${post.statusText}`);
      return null;
    }

    return await post.text();
  } catch (err) {
    console.warn('[OTP] Fetch error:', err);
    return null;
  }
}

export async function getRouteReliability(origin: string, dest: string): Promise<RouteReliability> {
  const originUpper = origin.toUpperCase();
  const destUpper = dest.toUpperCase();
  const period = buildOtpPeriod();
  const cacheKey = `otp:${originUpper}:${destUpper}:${period.label}`;

  if (process.env.OTP_DISABLE === 'true') {
    return {
      origin: originUpper,
      dest: destUpper,
      delayPct: null,
      totalFlights: null,
      periodLabel: period.label,
      source: OTP_SOURCE,
      available: false,
      message: 'BTS on-time data unavailable',
    };
  }

  const cached = cacheGet<RouteReliability>(cacheKey);
  if (cached) return cached;

  const html = await fetchOtpHtml(originUpper, destUpper, period);
  if (!html) {
    const result: RouteReliability = {
      origin: originUpper,
      dest: destUpper,
      delayPct: null,
      totalFlights: null,
      periodLabel: period.label,
      source: OTP_SOURCE,
      available: false,
      message: 'BTS on-time data unavailable',
    };
    cacheSet(cacheKey, result, OTP_CACHE_TTL);
    return result;
  }

  const { delayPct, totalFlights } = parseOtpStats(html);
  const available = delayPct !== null;

  const result: RouteReliability = {
    origin: originUpper,
    dest: destUpper,
    delayPct,
    totalFlights,
    periodLabel: period.label,
    source: OTP_SOURCE,
    available,
    message: available ? undefined : 'BTS on-time data unavailable',
  };

  cacheSet(cacheKey, result, OTP_CACHE_TTL);
  return result;
}
