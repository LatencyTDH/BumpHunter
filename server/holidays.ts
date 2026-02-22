import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// =============================================================================
// Holiday / Event Calendar Scoring
//
// Loads static holiday data from data/holidays_events.json and scores a given
// date based on proximity to high-demand travel periods.
//
// Supports three entry types:
//   - holidays: single-date events with travel windows (Thanksgiving, Christmas)
//   - periods: date ranges (spring break, summer peak, holiday season)
//   - events: major events with optional airport tags (Super Bowl, CES, SXSW)
//
// Returns the highest matching intensity (doesn't stack).
// =============================================================================

interface HolidayEntry {
  name: string;
  dates: string[];
  travelWindowBefore: number;
  travelWindowAfter: number;
  intensity: number;
}

interface PeriodEntry {
  name: string;
  ranges: { start: string; end: string }[];
  intensity: number;
}

interface EventEntry {
  name: string;
  dates: string[];
  travelWindowBefore: number;
  travelWindowAfter: number;
  intensity: number;
  airports?: string[];
}

interface HolidayData {
  holidays: HolidayEntry[];
  periods: PeriodEntry[];
  events: EventEntry[];
}

export interface HolidayMatch {
  name: string;
  intensity: number;  // 0-15
  daysUntil: number;  // positive = future, negative = past, 0 = on the day
}

// ---------------------------------------------------------------------------
// Load holiday data once at module init
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dataPath = join(__dirname, '..', 'data', 'holidays_events.json');
const holidayData: HolidayData = JSON.parse(readFileSync(dataPath, 'utf-8'));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a Date as YYYY-MM-DD in local time */
function toDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Days from dateStr1 → dateStr2 (positive if dateStr2 is later) */
function daysBetween(dateStr1: string, dateStr2: string): number {
  const d1 = new Date(dateStr1 + 'T00:00:00');
  const d2 = new Date(dateStr2 + 'T00:00:00');
  return Math.round((d2.getTime() - d1.getTime()) / (86400000));
}

/**
 * Check a single-date entry (holiday or event) against a target date.
 * Returns the decayed intensity score if within the travel window, else 0.
 */
function scoreWindowEntry(
  dateStr: string,
  entryDate: string,
  windowBefore: number,
  windowAfter: number,
  intensity: number,
): { score: number; daysUntil: number } {
  const diff = daysBetween(dateStr, entryDate); // positive = holiday in future
  const absDiff = Math.abs(diff);

  // Which side of the window are we on?
  const windowSize = diff >= 0 ? windowBefore : windowAfter;

  if (absDiff > windowSize) {
    return { score: 0, daysUntil: diff };
  }

  // Decay: full intensity on the day, -1 per day distance, floor at 50% intensity
  const score = Math.max(
    Math.ceil(intensity * 0.5),
    intensity - absDiff,
  );

  return { score, daysUntil: diff };
}

// ---------------------------------------------------------------------------
// Main scoring function
// ---------------------------------------------------------------------------

export function getHolidayScore(date: Date): { score: number; match: HolidayMatch | null } {
  const dateStr = toDateStr(date);

  let bestScore = 0;
  let bestMatch: HolidayMatch | null = null;

  // Check holidays (single-date with travel windows)
  for (const holiday of holidayData.holidays) {
    for (const hDate of holiday.dates) {
      const { score, daysUntil } = scoreWindowEntry(
        dateStr, hDate,
        holiday.travelWindowBefore, holiday.travelWindowAfter,
        holiday.intensity,
      );
      if (score > bestScore) {
        bestScore = score;
        bestMatch = { name: holiday.name, intensity: score, daysUntil };
      }
    }
  }

  // Check events (single-date with travel windows, optionally airport-scoped)
  for (const event of holidayData.events) {
    for (const eDate of event.dates) {
      const { score, daysUntil } = scoreWindowEntry(
        dateStr, eDate,
        event.travelWindowBefore, event.travelWindowAfter,
        event.intensity,
      );
      if (score > bestScore) {
        bestScore = score;
        bestMatch = { name: event.name, intensity: score, daysUntil };
      }
    }
  }

  // Check periods (date ranges — full intensity for every day in range)
  for (const period of holidayData.periods) {
    for (const range of period.ranges) {
      const afterStart = daysBetween(range.start, dateStr); // >= 0 means date is on or after start
      const beforeEnd = daysBetween(dateStr, range.end);    // >= 0 means date is on or before end

      if (afterStart >= 0 && beforeEnd >= 0) {
        if (period.intensity > bestScore) {
          bestScore = period.intensity;
          bestMatch = { name: period.name, intensity: period.intensity, daysUntil: 0 };
        }
      }
    }
  }

  return { score: bestScore, match: bestMatch };
}

// ---------------------------------------------------------------------------
// Tag formatting for scoring factor display
// ---------------------------------------------------------------------------

const MAJOR_HOLIDAYS = new Set([
  'Thanksgiving', 'Christmas', 'Independence Day',
  'Memorial Day', 'Labor Day', "New Year's Day",
]);

export function formatHolidayTag(match: HolidayMatch): string {
  const { name } = match;

  // Period-specific tags
  if (name === 'Spring Break') return 'Spring break window';
  if (name === 'Summer Peak') return 'Summer peak travel period';
  if (name === 'Holiday Season') return 'Holiday season travel corridor';

  // Major events
  if (name.startsWith('Super Bowl') || name === 'CES' || name === 'SXSW') {
    return `${name} travel surge`;
  }

  // Major holidays → DOT peak period tag
  if (MAJOR_HOLIDAYS.has(name)) {
    return `${name} travel week (DOT peak period)`;
  }

  // Minor holidays / 3-day weekends
  return `${name} weekend`;
}
