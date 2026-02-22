// =============================================================================
// Frontend API Client — communicates with BumpHunter backend
// =============================================================================

const API_BASE = '/api';

// --- Structured error result type ---

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number };

// --- Retry & timeout configuration ---

const MAX_RETRIES = 2;
const RETRY_DELAYS = [1000, 2000];
const REQUEST_TIMEOUT_MS = 30_000; // Increased — FR24 feed can take a moment

// --- Error message helpers ---

function classifyError(err: unknown, status?: number): { error: string; status?: number } {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return { error: 'Request timed out. The data sources may be slow — try again.' };
  }
  if (err instanceof TypeError && (err.message.includes('fetch') || err.message.includes('network') || err.message.includes('Failed'))) {
    return { error: 'Backend server is not running. Start it with: npm run dev' };
  }
  if (status === 429) {
    return { error: 'Data source rate limit reached. Results are cached — try again in a few minutes.', status };
  }
  if (status !== undefined && status >= 500) {
    return { error: 'Server error while fetching data. Check the API logs.', status };
  }
  if (status !== undefined && !isOkStatus(status)) {
    return { error: `API error: ${status}`, status };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return { error: msg };
}

function isOkStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

function isRetryable(status?: number, err?: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (err instanceof TypeError) return true;
  if (status !== undefined && (status === 429 || status >= 500)) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Core fetch with retry + timeout ---

async function apiFetchSafe<T>(path: string, options?: RequestInit): Promise<ApiResult<T>> {
  let lastError: unknown;
  let lastStatus: number | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await sleep(RETRY_DELAYS[attempt - 1] ?? RETRY_DELAYS[RETRY_DELAYS.length - 1]);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        signal: controller.signal,
        headers: { 'Accept': 'application/json', ...options?.headers },
      });

      clearTimeout(timeoutId);
      lastStatus = res.status;

      if (!res.ok) {
        if (isRetryable(res.status) && attempt < MAX_RETRIES) {
          lastError = new Error(`HTTP ${res.status}`);
          continue;
        }
        return { ok: false, ...classifyError(new Error(`HTTP ${res.status}`), res.status) };
      }

      const data = (await res.json()) as T;
      return { ok: true, data };
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err;
      lastStatus = undefined;

      if (isRetryable(undefined, err) && attempt < MAX_RETRIES) {
        continue;
      }

      return { ok: false, ...classifyError(err) };
    }
  }

  return { ok: false, ...classifyError(lastError, lastStatus) };
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const result = await apiFetchSafe<T>(path, options);
  if (!result.ok) {
    throw new Error((result as { ok: false; error: string }).error);
  }
  return (result as { ok: true; data: T }).data;
}

// --- Types matching server responses ---

export type FactorDetail = {
  name: string;
  score: number;
  maxScore: number;
  description: string;
};

export type Flight = {
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
  // Rich fields from FR24 Schedule API
  status: string;           // "Scheduled", "In Air", "Estimated dep 07:48"
  registration: string;     // "N848DN"
  codeshares: string[];     // ["AF6825", "KE7079"]
  aircraftFullName: string; // "Airbus A321-211"
  // Last-flight-of-day + DOT compensation
  lastFlightOfDay: boolean;
  compensation: {
    lastFlightOfDay: boolean;
    nextFlightDepTime: string | null;
    rebookingDelayHours: number;
    tier: 'none' | '200pct' | '400pct';
    tierLabel: string;
    maxCompensation: number;
    estimatedCompensation: number;
    compensationDisplay: string;
    explanation: string;
  };
};

export type WeatherAlert = {
  id: string;
  hub: string;
  airportName: string;
  severity: 'severe' | 'moderate' | 'minor';
  reason: string;
  impact: string;
  details: string;
  color: string;
  bg: string;
  border: string;
  rawMetar: string;
};

export type CarrierStats = {
  code: string;
  name: string;
  dbRate: number;
  idbRate: number;
  vdbRate: number;
  loadFactor: number;
  loadFactorPct: number;
  avgCompensation: number | null;
  avgCompensationDisplay: string;
  compensationNote: string;
  oversaleRate: number;
};

export type QuarterlyTrend = {
  quarter: string;
  totalEnplanements: number;
  voluntaryDB: number;
  involuntaryDB: number;
  avgCompensation: number | null;
  avgCompensationDisplay: string;
};

export type OversoldRoute = {
  origin: string;
  destination: string;
  carrier: string;
  carrierName: string;
  avgOversaleRate: number;
  avgBumps: number;
  avgCompensation: number | null;
  avgCompensationDisplay: string;
};

export type SummaryData = {
  activeAlerts: number;
  severeAlerts: number;
  latestQuarter: string;
  quarterlyVDB: number;
  avgCompensation: number;
  totalVDBTwoYears: number;
  topCarrier: CarrierStats;
  alerts: WeatherAlert[];
};

// --- Response types ---

export type FlightSearchMeta = {
  origin: string;
  destination: string;
  date: string;
  totalFlights: number;
  verifiedFlights: number;
  dataSources: string[];
  dataSource: 'live' | 'none';
  message: string | null;
  rateLimited: boolean;
  openskyRateLimited: boolean;
  btsDataPeriod?: string;
  btsDataWarning?: string;
  timestamp: string;
};

export type FlightSearchResponse = {
  flights: Flight[];
  meta: FlightSearchMeta;
};

type WeatherAlertsResponse = {
  alerts: WeatherAlert[];
  hubs: string[];
  source: string;
  timestamp: string;
};

type CarrierStatsResponse = {
  carriers: CarrierStats[];
  source: string;
  note: string;
  dataNote: string;
};

type QuarterlyTrendsResponse = {
  trends: QuarterlyTrend[];
  source: string;
  dataNote: string;
};

type TopRoutesResponse = {
  routes: OversoldRoute[];
  source: string;
  dataNote: string;
};

// --- FAA Status types ---

export type FAAStatus = {
  airport: string;
  delay: boolean;
  delayType?: 'GDP' | 'GS' | 'CLOSURE' | 'DELAY';
  reason?: string;
  avgDelay?: string;
  source?: string;
  timestamp?: string;
};

// --- API calls ---

export async function getFAAStatus(airport: string): Promise<FAAStatus> {
  return apiFetch(`/faa/status?airport=${encodeURIComponent(airport)}`);
}

export async function getFAAStatusSafe(airport: string): Promise<ApiResult<FAAStatus>> {
  return apiFetchSafe(`/faa/status?airport=${encodeURIComponent(airport)}`);
}

export async function searchFlights(origin: string, dest: string, date: string): Promise<FlightSearchResponse> {
  return apiFetch(`/flights/search?origin=${encodeURIComponent(origin)}&dest=${encodeURIComponent(dest)}&date=${encodeURIComponent(date)}`);
}

export async function getWeatherAlerts(hubs?: string[]): Promise<WeatherAlertsResponse> {
  const params = hubs ? `?hubs=${hubs.join(',')}` : '';
  return apiFetch(`/weather/alerts${params}`);
}

export async function getSummary(): Promise<SummaryData> {
  return apiFetch('/stats/summary');
}

export async function getCarrierStats(): Promise<CarrierStatsResponse> {
  return apiFetch('/stats/carriers');
}

export async function getQuarterlyTrends(): Promise<QuarterlyTrendsResponse> {
  return apiFetch('/stats/trends');
}

export async function getTopRoutes(): Promise<TopRoutesResponse> {
  return apiFetch('/stats/routes');
}

// --- Safe API calls ---

export async function searchFlightsSafe(origin: string, dest: string, date: string): Promise<ApiResult<FlightSearchResponse>> {
  return apiFetchSafe(`/flights/search?origin=${encodeURIComponent(origin)}&dest=${encodeURIComponent(dest)}&date=${encodeURIComponent(date)}`);
}

export async function getWeatherAlertsSafe(hubs?: string[]): Promise<ApiResult<WeatherAlertsResponse>> {
  const params = hubs ? `?hubs=${hubs.join(',')}` : '';
  return apiFetchSafe(`/weather/alerts${params}`);
}

export async function getSummarySafe(): Promise<ApiResult<SummaryData>> {
  return apiFetchSafe('/stats/summary');
}

export async function getCarrierStatsSafe(): Promise<ApiResult<CarrierStatsResponse>> {
  return apiFetchSafe('/stats/carriers');
}

export async function getQuarterlyTrendsSafe(): Promise<ApiResult<QuarterlyTrendsResponse>> {
  return apiFetchSafe('/stats/trends');
}

export async function getTopRoutesSafe(): Promise<ApiResult<TopRoutesResponse>> {
  return apiFetchSafe('/stats/routes');
}
