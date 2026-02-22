import {
  CARRIER_STATS,
  QUARTERLY_TRENDS,
  TOP_OVERSOLD_ROUTES,
  getOperatingCarrierStats,
} from './data.js';
import { getHolidayScore, formatHolidayTag } from './holidays.js';

export type HeatmapFactor = {
  name: string;
  score: number;
  maxScore: number;
  description: string;
};

export type HeatmapDay = {
  date: string;
  predictedScore: number;
  factors: HeatmapFactor[];
};

const DAY_SCORES: Record<number, { score: number; label: string }> = {
  0: { score: 15, label: 'Sunday return travel' },
  1: { score: 12, label: 'Monday business peak' },
  2: { score: 5,  label: '' },
  3: { score: 5,  label: '' },
  4: { score: 10, label: 'Thursday pre-weekend travel' },
  5: { score: 12, label: 'Friday departure peak' },
  6: { score: 7,  label: 'Saturday leisure travel' },
};

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-CA');
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function scoreTimingAndDemand(date: Date): { score: number; factors: string[] } {
  const day = DAY_SCORES[date.getDay()] ?? { score: 5, label: '' };
  const holiday = getHolidayScore(date);
  const factors: string[] = [];

  const score = Math.min(15, Math.max(day.score, holiday.score));

  if (holiday.match && holiday.score >= day.score) {
    factors.push(formatHolidayTag(holiday.match));
  } else {
    if (day.label) factors.push(day.label);
    if (holiday.match && holiday.score > 0) {
      factors.push(formatHolidayTag(holiday.match));
    }
  }

  return { score, factors };
}

function getCarrierForRoute(origin: string, dest: string): { code: string; name: string; source: string } {
  const match = TOP_OVERSOLD_ROUTES.find(r =>
    (r.origin === origin && r.destination === dest) ||
    (r.origin === dest && r.destination === origin)
  );

  if (match) {
    return { code: match.carrier, name: match.carrierName, source: 'ATCR 2025 top routes' };
  }

  return { code: 'AVG', name: 'Industry average', source: 'ATCR 2025 average' };
}

function scoreCarrierRate(carrierCode: string, carrierName: string): { score: number; factor: string; dbRate: number } {
  const { stats } = getOperatingCarrierStats(carrierCode, carrierCode);
  const allRates = Object.values(CARRIER_STATS).map(c => c.dbRate);
  const maxRate = Math.max(...allRates);
  const minRate = Math.min(...allRates);
  const range = maxRate - minRate;

  const normalized = range > 0
    ? 5 + ((stats.dbRate - minRate) / range) * 23
    : 15;

  const score = Math.round(Math.min(30, Math.max(3, normalized)));
  const factor = `${carrierName} DB: ${stats.dbRate.toFixed(2)}/10k (ATCR 2025)`;

  return { score, factor, dbRate: stats.dbRate };
}

function buildQuarterRates(): { byQuarter: Record<number, number>; overall: number } {
  const buckets: Record<number, number[]> = { 1: [], 2: [], 3: [], 4: [] };

  for (const trend of QUARTERLY_TRENDS) {
    const match = trend.quarter.match(/Q([1-4])/i);
    if (!match) continue;
    const quarter = parseInt(match[1], 10);
    if (!trend.totalEnplanements) continue;

    const dbTotal = trend.voluntaryDB + trend.involuntaryDB;
    const rate = (dbTotal / trend.totalEnplanements) * 10000;
    buckets[quarter].push(rate);
  }

  const avg = (values: number[]) => values.length > 0
    ? values.reduce((sum, v) => sum + v, 0) / values.length
    : 0;

  const byQuarter: Record<number, number> = {
    1: avg(buckets[1]),
    2: avg(buckets[2]),
    3: avg(buckets[3]),
    4: avg(buckets[4]),
  };

  const overallValues = Object.values(byQuarter).filter(v => v > 0);
  const overall = overallValues.length > 0
    ? overallValues.reduce((sum, v) => sum + v, 0) / overallValues.length
    : 0;

  return { byQuarter, overall };
}

const QUARTER_RATES = buildQuarterRates();

function scoreSeasonalPattern(date: Date): { score: number; description: string } {
  const quarter = Math.floor(date.getMonth() / 3) + 1;
  const quarterRate = QUARTER_RATES.byQuarter[quarter] || 0;
  const overall = QUARTER_RATES.overall || 0;

  if (!quarterRate || !overall) {
    return { score: 0, description: 'Seasonal trend unavailable' };
  }

  const ratio = quarterRate / overall;
  let score = 2;
  if (ratio >= 1.2) score = 10;
  else if (ratio >= 1.1) score = 8;
  else if (ratio >= 1.0) score = 6;
  else if (ratio >= 0.9) score = 4;

  const description = `Seasonal trend Q${quarter}: ${quarterRate.toFixed(2)}/10k vs avg ${overall.toFixed(2)}/10k`;
  return { score, description };
}

export function buildHeatmap(origin: string, dest: string, weeks = 4): HeatmapDay[] {
  const days: HeatmapDay[] = [];
  const windowWeeks = clamp(Math.round(weeks || 4), 1, 12);

  const carrierChoice = getCarrierForRoute(origin, dest);
  const carrierScore = scoreCarrierRate(carrierChoice.code, carrierChoice.name);

  // Use noon Eastern to avoid DST date-boundary issues
  const now = new Date();
  const start = new Date(
    now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) + 'T12:00:00-05:00'
  );

  for (let i = 0; i < windowWeeks * 7; i++) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);

    const timing = scoreTimingAndDemand(date);
    const seasonal = scoreSeasonalPattern(date);

    const raw = carrierScore.score + timing.score + seasonal.score;
    const max = 30 + 15 + 10;
    const predictedScore = clamp(Math.round((raw / max) * 100), 5, 100);

    const factors: HeatmapFactor[] = [
      {
        name: 'Carrier Rate',
        score: carrierScore.score,
        maxScore: 30,
        description: carrierScore.factor,
      },
      {
        name: 'Timing & Demand',
        score: timing.score,
        maxScore: 15,
        description: timing.factors.length > 0 ? timing.factors.join(' · ') : 'Midweek baseline',
      },
      {
        name: 'Seasonal Pattern',
        score: seasonal.score,
        maxScore: 10,
        description: seasonal.description,
      },
    ];

    days.push({
      date: formatDate(date),
      predictedScore,
      factors,
    });
  }

  return days;
}
