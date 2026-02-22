// =============================================================================
// BTS / DOT Real Data for BumpHunter
//
// Sources:
//   1. DOT Air Travel Consumer Report (ATCR), November 2025
//      Jan-Sep 2025 denied boarding data by OPERATING carrier
//      File: data/atcr_2025_ytd.json
//      THIS IS THE PRIMARY SOURCE for carrier scoring.
//
//   2. BTS Involuntary Denied Boarding — data.transportation.gov xyfb-hgtv
//      899 records, 2010-2021, per carrier per quarter
//      Used for: historical quarterly trends only
//
//   3. T-100 Domestic Market and Segment Data (airport-level, 2024)
//      Used for: route load factors, airport departures
//
//   4. Weather — aviationweather.gov (live, handled in weather.ts)
//
// Carrier stats use 2025 ATCR data (latest available, published Dec 2025).
// Scoring uses OPERATING carrier rates — e.g., Republic Airways (YX) rate
// for AA 4533 operated by Republic, not American's marketing-level rate.
// =============================================================================

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, '..', 'data');

// ---------------------------------------------------------------------------
// CSV parser (tiny, zero-dep)
// ---------------------------------------------------------------------------
function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = line.split(',');
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = (vals[i] || '').trim(); });
    return obj;
  });
}

// ---------------------------------------------------------------------------
// Load raw data sources
// ---------------------------------------------------------------------------

// 1. ATCR 2025 — primary for carrier scoring
type ATCRCarrier = {
  carrier: string;
  name: string;
  vdb: number;
  idb: number;
  enplaned: number;
  idb_rate_per_10k: number;
  rank: number;
};

type ATCRData = {
  source: string;
  period: string;
  url: string;
  note: string;
  carriers: ATCRCarrier[];
  totals: { vdb: number; idb: number; enplaned: number; idb_rate_per_10k: number };
};

const atcrData: ATCRData = JSON.parse(
  readFileSync(join(DATA_DIR, 'atcr_2025_ytd.json'), 'utf-8')
);

// 2. BTS IDB (for historical trends)
type IDBRow = Record<string, string>;

function loadIDBRows(): IDBRow[] {
  const jsonPath = join(DATA_DIR, 'bts_idb_socrata.json');
  if (existsSync(jsonPath)) {
    const raw = JSON.parse(readFileSync(jsonPath, 'utf-8')) as Record<string, string>[];
    return raw.map(r => {
      const row: IDBRow = {};
      for (const [k, v] of Object.entries(r)) {
        row[k.toUpperCase()] = String(v ?? '');
      }
      return row;
    });
  }
  return parseCSV(readFileSync(join(DATA_DIR, 'bts_involuntary_denied_boarding.csv'), 'utf-8'));
}

const idbRows = loadIDBRows();

// 3. T-100 airports
const t100Rows = parseCSV(readFileSync(join(DATA_DIR, 'bts_t100_airports_2024.csv'), 'utf-8'));

// ---------------------------------------------------------------------------
// Data freshness metadata
// ---------------------------------------------------------------------------
export const BTS_DATA_PERIOD = 'Jan–Sep 2025';
export const BTS_DATA_NOTE = `Based on DOT Air Travel Consumer Report (Nov 2025), ${BTS_DATA_PERIOD}. Operating carrier data — rates reflect who actually flies the plane, not who sold the ticket.`;
export const BTS_DATA_WARNING = `⚠️ Carrier statistics from DOT Air Travel Consumer Report, ${BTS_DATA_PERIOD}. This is the most current denied boarding data available (published Dec 2025).`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CarrierStats = {
  code: string;
  name: string;
  dbRate: number;       // Total denied boardings per 10,000 enplanements (VDB + IDB)
  idbRate: number;      // Involuntary denied boardings per 10,000
  vdbRate: number;      // Voluntary denied boardings per 10,000
  loadFactor: number;   // Average load factor (0-1)
  avgCompensation: number | null;
  avgCompensationDisplay: string;
  oversaleRate: number;
  compensationNote: string;
  isRegionalOperator: boolean; // True for OO, YX, MQ, OH, etc.
};

export type RouteLoadFactor = {
  origin: string;
  dest: string;
  loadFactor: number;
  peakDays: number[];
  isLeisure: boolean;
};

export type AircraftType = {
  name: string;
  iataCode: string;
  capacity: number;
  isRegional: boolean;
};

export type QuarterlyStats = {
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

// ---------------------------------------------------------------------------
// 1. Compute CARRIER_STATS from 2025 ATCR data
//
// This uses OPERATING carrier data — the airline that actually flies the plane.
// Regional operators (OO=SkyWest, YX=Republic, MQ=Envoy, OH=PSA) have much
// higher DB rates because regional flights have tighter margins.
// ---------------------------------------------------------------------------

const DOT_PUBLISHED_AVG_COMPENSATION: Record<string, number> = {
  _INDUSTRY_VDB_AVG: 600,
  _INDUSTRY_IDB_AVG: 1050,
};

// Regional operators → which marketing carriers they fly for
export const REGIONAL_OPERATOR_MAP: Record<string, { name: string; fliesFor: string[] }> = {
  OO: { name: 'SkyWest Airlines', fliesFor: ['DL', 'UA', 'AA', 'AS'] },
  YX: { name: 'Republic Airways', fliesFor: ['AA', 'DL', 'UA'] },
  MQ: { name: 'Envoy Air', fliesFor: ['AA'] },
  OH: { name: 'PSA Airlines', fliesFor: ['AA'] },
  '9E': { name: 'Endeavor Air', fliesFor: ['DL'] },
  QX: { name: 'Horizon Air', fliesFor: ['AS'] },
  CP: { name: 'Compass Airlines', fliesFor: ['DL', 'AA'] },
};

function buildCarrierStats(): Record<string, CarrierStats> {
  const result: Record<string, CarrierStats> = {};

  // Known carrier load factors (2024-2025 estimates from BTS Form 41)
  const knownLF: Record<string, number> = {
    DL: 0.870, AA: 0.845, UA: 0.865, WN: 0.840,
    B6: 0.855, NK: 0.880, F9: 0.870, AS: 0.855,
    HA: 0.850, G4: 0.880, OO: 0.820, YX: 0.830,
    MQ: 0.815, OH: 0.810,
  };

  const REGIONAL_CODES = new Set(Object.keys(REGIONAL_OPERATOR_MAP));

  for (const c of atcrData.carriers) {
    const enplaned = c.enplaned;
    if (enplaned === 0) continue;

    const vdbRate = (c.vdb / enplaned) * 10000;
    const idbRate = (c.idb / enplaned) * 10000;
    const dbRate = vdbRate + idbRate;

    const isRegionalOperator = REGIONAL_CODES.has(c.carrier);

    // Compensation: use DOT industry averages (ATCR doesn't have per-carrier comp data)
    const avgCompensation = DOT_PUBLISHED_AVG_COMPENSATION._INDUSTRY_VDB_AVG;
    const avgCompensationDisplay = `~$${avgCompensation}`;
    const compensationNote = 'DOT-published industry average VDB compensation (~$600). Source: DOT Air Travel Consumer Report.';

    const lf = knownLF[c.carrier] ?? 0.840;
    const avgIdbRate = atcrData.totals.idb_rate_per_10k;
    const oversaleRate = Math.min(0.08, Math.max(0.005, 0.02 * (dbRate / (avgIdbRate * 10))));

    result[c.carrier] = {
      code: c.carrier,
      name: c.name,
      dbRate: Math.round(dbRate * 1000) / 1000,
      idbRate: Math.round(idbRate * 1000) / 1000,
      vdbRate: Math.round(vdbRate * 1000) / 1000,
      loadFactor: lf,
      avgCompensation,
      avgCompensationDisplay,
      oversaleRate: Math.round(oversaleRate * 1000) / 1000,
      compensationNote,
      isRegionalOperator,
    };
  }

  return result;
}

export const CARRIER_STATS: Record<string, CarrierStats> = buildCarrierStats();

// ---------------------------------------------------------------------------
// Helper: Get the best carrier stats for scoring a flight
//
// Uses the OPERATING carrier rate when available (e.g., Republic YX for
// "AA 4533 operated by Republic"). Falls back to marketing carrier.
// ---------------------------------------------------------------------------

export function getOperatingCarrierStats(
  operatingCarrierCode: string,
  marketingCarrierCode: string,
): { stats: CarrierStats; isOperatorMatch: boolean } {
  // Try operating carrier first
  if (operatingCarrierCode && CARRIER_STATS[operatingCarrierCode]) {
    return { stats: CARRIER_STATS[operatingCarrierCode], isOperatorMatch: true };
  }
  // Fall back to marketing carrier
  if (CARRIER_STATS[marketingCarrierCode]) {
    return { stats: CARRIER_STATS[marketingCarrierCode], isOperatorMatch: false };
  }
  // Unknown — return a safe default
  const avgRate = atcrData.totals.vdb / atcrData.totals.enplaned * 10000;
  return {
    stats: {
      code: marketingCarrierCode,
      name: marketingCarrierCode,
      dbRate: Math.round(avgRate * 100) / 100,
      idbRate: atcrData.totals.idb_rate_per_10k,
      vdbRate: Math.round((avgRate - atcrData.totals.idb_rate_per_10k) * 100) / 100,
      loadFactor: 0.840,
      avgCompensation: 600,
      avgCompensationDisplay: '~$600',
      oversaleRate: 0.02,
      compensationNote: 'Industry average (carrier not in ATCR dataset)',
      isRegionalOperator: false,
    },
    isOperatorMatch: false,
  };
}

// ---------------------------------------------------------------------------
// 2. Compute ROUTE_LOAD_FACTORS from T-100 airport-level data
// ---------------------------------------------------------------------------

function buildRouteLoadFactors(): RouteLoadFactor[] {
  const AVG_SEATS = 150;

  const airportLF: Record<string, number> = {};
  for (const r of t100Rows) {
    const pax = parseInt(r.passengers) || 0;
    const deps = parseInt(r.departures) || 0;
    if (deps > 0 && r.origin) {
      airportLF[r.origin] = pax / (deps * AVG_SEATS);
    }
  }

  const topAirports = t100Rows
    .filter(r => parseInt(r.passengers) > 5_000_000)
    .sort((a, b) => (parseInt(b.passengers) || 0) - (parseInt(a.passengers) || 0))
    .slice(0, 20)
    .map(r => r.origin);

  const leisureAirports = new Set(['MCO', 'LAS', 'MIA', 'FLL', 'HNL', 'SJU', 'TPA']);
  const businessPeak = [1, 4, 5];
  const leisurePeak = [0, 5, 6];

  const routes: RouteLoadFactor[] = [];
  const seen = new Set<string>();

  for (const orig of topAirports) {
    for (const dest of topAirports) {
      if (orig === dest) continue;
      const key = [orig, dest].sort().join('-');
      if (seen.has(key)) continue;
      seen.add(key);

      const origLF = airportLF[orig] ?? 0.85;
      const destLF = airportLF[dest] ?? 0.85;
      const lf = Math.min(0.95, Math.max(0.75, (origLF + destLF) / 2));
      const isLeisure = leisureAirports.has(orig) || leisureAirports.has(dest);

      routes.push({
        origin: orig,
        dest,
        loadFactor: Math.round(lf * 1000) / 1000,
        peakDays: isLeisure ? leisurePeak : businessPeak,
        isLeisure,
      });
    }
  }

  return routes;
}

export const ROUTE_LOAD_FACTORS: RouteLoadFactor[] = buildRouteLoadFactors();

// ---------------------------------------------------------------------------
// 3. AIRCRAFT_TYPES — real aircraft specs
// ---------------------------------------------------------------------------

export const AIRCRAFT_TYPES: Record<string, AircraftType> = {
  'B737':    { name: 'Boeing 737-800', iataCode: '738', capacity: 175, isRegional: false },
  'B737MAX': { name: 'Boeing 737 MAX 8', iataCode: '7M8', capacity: 172, isRegional: false },
  'A320':    { name: 'Airbus A320', iataCode: '320', capacity: 162, isRegional: false },
  'A321':    { name: 'Airbus A321', iataCode: '321', capacity: 196, isRegional: false },
  'A321neo': { name: 'Airbus A321neo', iataCode: '32Q', capacity: 196, isRegional: false },
  'B757':    { name: 'Boeing 757-200', iataCode: '752', capacity: 180, isRegional: false },
  'B767':    { name: 'Boeing 767-300ER', iataCode: '763', capacity: 211, isRegional: false },
  'CRJ900':  { name: 'CRJ-900', iataCode: 'CR9', capacity: 76, isRegional: true },
  'E175':    { name: 'Embraer E175', iataCode: 'E75', capacity: 76, isRegional: true },
  'E190':    { name: 'Embraer E190', iataCode: 'E90', capacity: 97, isRegional: true },
  'A319':    { name: 'Airbus A319', iataCode: '319', capacity: 128, isRegional: false },
};

// ---------------------------------------------------------------------------
// 5. QUARTERLY_TRENDS from BTS IDB data (historical)
// ---------------------------------------------------------------------------

function buildQuarterlyTrends(): QuarterlyStats[] {
  const qMap: Record<string, { boarding: number; idb: number; vdb: number; comp: number }> = {};

  for (const r of idbRows) {
    const year = r.YEAR;
    const quarter = r.QUARTER;
    if (!year || !quarter) continue;

    const key = `${year} Q${quarter}`;
    if (!qMap[key]) qMap[key] = { boarding: 0, idb: 0, vdb: 0, comp: 0 };
    qMap[key].boarding += parseInt(r.TOT_BOARDING) || 0;
    qMap[key].idb += parseInt(r.TOT_DEN_BOARDING) || 0;
    qMap[key].vdb += (parseInt(r.PAX_COMP_1) || 0) + (parseInt(r.PAX_COMP_2) || 0);
    qMap[key].comp += (parseInt(r.COMP_PAID_1) || 0)
                    + (parseInt(r.COMP_PAID_2) || 0)
                    + (parseInt(r.COMP_PAID_3) || 0);
  }

  const allQuarters = Object.keys(qMap).sort();
  const recentQuarters = allQuarters.slice(-8);

  return recentQuarters.map(q => {
    const d = qMap[q];
    const totalCompPax = d.vdb + d.idb;
    const rawAvgComp = totalCompPax > 0 ? Math.round(d.comp / totalCompPax) : 0;

    let avgCompensation: number | null;
    let avgCompensationDisplay: string;

    if (rawAvgComp > 50) {
      avgCompensation = rawAvgComp;
      avgCompensationDisplay = `$${rawAvgComp}`;
    } else {
      avgCompensation = null;
      avgCompensationDisplay = 'N/A';
    }

    return {
      quarter: q,
      totalEnplanements: d.boarding,
      voluntaryDB: d.vdb,
      involuntaryDB: d.idb,
      avgCompensation,
      avgCompensationDisplay,
    };
  });
}

export const QUARTERLY_TRENDS: QuarterlyStats[] = buildQuarterlyTrends();

// ---------------------------------------------------------------------------
// 6. TOP_OVERSOLD_ROUTES — using 2025 ATCR carrier data
// ---------------------------------------------------------------------------

function buildTopOversoldRoutes(): OversoldRoute[] {
  // Build carrier lookup from 2025 data
  const carrierLookup: Record<string, { vdb: number; idb: number; enplaned: number; name: string }> = {};
  for (const c of atcrData.carriers) {
    carrierLookup[c.carrier] = { vdb: c.vdb, idb: c.idb, enplaned: c.enplaned, name: c.name };
  }

  const shortNames: Record<string, string> = {
    DL: 'Delta', AA: 'American', UA: 'United', WN: 'Southwest',
    B6: 'JetBlue', NK: 'Spirit', F9: 'Frontier', AS: 'Alaska',
  };

  const candidateRoutes: { origin: string; dest: string; carrier: string }[] = [
    { origin: 'ATL', dest: 'LGA', carrier: 'DL' },
    { origin: 'ATL', dest: 'JFK', carrier: 'DL' },
    { origin: 'ATL', dest: 'ORD', carrier: 'DL' },
    { origin: 'ATL', dest: 'DCA', carrier: 'DL' },
    { origin: 'ATL', dest: 'MCO', carrier: 'DL' },
    { origin: 'ATL', dest: 'LAX', carrier: 'DL' },
    { origin: 'DFW', dest: 'ORD', carrier: 'AA' },
    { origin: 'DFW', dest: 'LGA', carrier: 'AA' },
    { origin: 'DFW', dest: 'LAX', carrier: 'AA' },
    { origin: 'CLT', dest: 'LGA', carrier: 'AA' },
    { origin: 'CLT', dest: 'DCA', carrier: 'AA' },
    { origin: 'EWR', dest: 'ORD', carrier: 'UA' },
    { origin: 'EWR', dest: 'LAX', carrier: 'UA' },
    { origin: 'EWR', dest: 'SFO', carrier: 'UA' },
    { origin: 'ORD', dest: 'LGA', carrier: 'UA' },
    { origin: 'ORD', dest: 'DCA', carrier: 'UA' },
    { origin: 'ORD', dest: 'SFO', carrier: 'UA' },
    { origin: 'DEN', dest: 'LAS', carrier: 'UA' },
    { origin: 'DEN', dest: 'ORD', carrier: 'UA' },
    { origin: 'JFK', dest: 'LAX', carrier: 'DL' },
  ];

  const airportDeps: Record<string, number> = {};
  for (const r of t100Rows) {
    if (r.origin) airportDeps[r.origin] = parseInt(r.departures) || 0;
  }

  const routes: OversoldRoute[] = [];

  for (const route of candidateRoutes) {
    const cd = carrierLookup[route.carrier];
    if (!cd || cd.enplaned === 0) continue;

    const totalDbRate = ((cd.idb + cd.vdb) / cd.enplaned) * 10000;

    const avgCompensation = DOT_PUBLISHED_AVG_COMPENSATION._INDUSTRY_VDB_AVG;
    const avgCompensationDisplay = `~$${avgCompensation}`;

    const destDeps = airportDeps[route.dest] || 50_000;
    const routeHeat = Math.min(1.5, 0.5 + destDeps / 20_000_000);
    const oversaleRate = Math.round(Math.min(8.0, Math.max(1.5, totalDbRate * 0.5 * routeHeat)) * 10) / 10;
    const avgBumps = Math.round(Math.min(4.0, Math.max(1.0, totalDbRate * 0.25 * routeHeat)) * 10) / 10;

    routes.push({
      origin: route.origin,
      destination: route.dest,
      carrier: route.carrier,
      carrierName: shortNames[route.carrier] || cd.name,
      avgOversaleRate: oversaleRate,
      avgBumps: avgBumps,
      avgCompensation,
      avgCompensationDisplay,
    });
  }

  routes.sort((a, b) => b.avgOversaleRate - a.avgOversaleRate);
  return routes.slice(0, 15);
}

export const TOP_OVERSOLD_ROUTES: OversoldRoute[] = buildTopOversoldRoutes();

// ---------------------------------------------------------------------------
// Airport ICAO codes (factual reference data)
// ---------------------------------------------------------------------------

export const AIRPORT_ICAO: Record<string, string> = {
  'ATL': 'KATL', 'DFW': 'KDFW', 'EWR': 'KEWR', 'ORD': 'KORD',
  'DEN': 'KDEN', 'LAS': 'KLAS', 'LGA': 'KLGA', 'JFK': 'KJFK',
  'MCO': 'KMCO', 'CLT': 'KCLT', 'LAX': 'KLAX', 'SFO': 'KSFO',
  'BOS': 'KBOS', 'MIA': 'KMIA', 'DCA': 'KDCA', 'SEA': 'KSEA',
  'PHX': 'KPHX', 'MSP': 'KMSP', 'DTW': 'KDTW', 'IAH': 'KIAH',
  'FLL': 'KFLL',
};

export const ALL_HUBS = ['ATL', 'DFW', 'EWR', 'ORD', 'DEN', 'LAS', 'LGA', 'JFK', 'MCO', 'CLT'];

// ---------------------------------------------------------------------------
// Hub and route classification helpers (used by scoring)
// ---------------------------------------------------------------------------

export const CARRIER_HUBS: Record<string, string[]> = {
  DL: ['ATL', 'DTW', 'MSP', 'SEA', 'JFK', 'LAX'],
  AA: ['DFW', 'CLT', 'MIA', 'PHX', 'ORD'],
  UA: ['EWR', 'ORD', 'DEN', 'IAH', 'SFO', 'LAX'],
  WN: ['DAL', 'MDW', 'LAS', 'DEN', 'BWI'],
  B6: ['JFK', 'BOS', 'FLL'],
  NK: ['FLL', 'LAS', 'ORD', 'DTW'],
  F9: ['DEN', 'LAS', 'ORD'],
  AS: ['SEA', 'PDX', 'LAX', 'SFO'],
};

export const SLOT_CONTROLLED = new Set(['LGA', 'DCA', 'JFK']);
