// =============================================================================
// Frontend API Client — communicates with BumpHunter backend
// =============================================================================

const API_BASE = '/api';

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Accept': 'application/json', ...options?.headers },
  });
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

// --- Types matching server responses ---

export type Flight = {
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
  avgCompensation: number;
  oversaleRate: number;
};

export type QuarterlyTrend = {
  quarter: string;
  totalEnplanements: number;
  voluntaryDB: number;
  involuntaryDB: number;
  avgCompensation: number;
};

export type OversoldRoute = {
  origin: string;
  destination: string;
  carrier: string;
  carrierName: string;
  avgOversaleRate: number;
  avgBumps: number;
  avgCompensation: number;
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

// --- API calls ---

export async function searchFlights(origin: string, dest: string, date: string): Promise<{
  flights: Flight[];
  meta: { origin: string; destination: string; date: string; totalFlights: number; dataSources: string[]; timestamp: string };
}> {
  return apiFetch(`/flights/search?origin=${encodeURIComponent(origin)}&dest=${encodeURIComponent(dest)}&date=${encodeURIComponent(date)}`);
}

export async function getWeatherAlerts(hubs?: string[]): Promise<{
  alerts: WeatherAlert[];
  hubs: string[];
  source: string;
  timestamp: string;
}> {
  const params = hubs ? `?hubs=${hubs.join(',')}` : '';
  return apiFetch(`/weather/alerts${params}`);
}

export async function getSummary(): Promise<SummaryData> {
  return apiFetch('/stats/summary');
}

export async function getCarrierStats(): Promise<{
  carriers: CarrierStats[];
  source: string;
  note: string;
}> {
  return apiFetch('/stats/carriers');
}

export async function getQuarterlyTrends(): Promise<{
  trends: QuarterlyTrend[];
  source: string;
}> {
  return apiFetch('/stats/trends');
}

export async function getTopRoutes(): Promise<{
  routes: OversoldRoute[];
  source: string;
}> {
  return apiFetch('/stats/routes');
}
