// =============================================================================
// Holiday / Event Calendar Scoring — ALGORITHMIC, NO HARDCODED DATES
//
// All US federal holidays are computed from rules (e.g., "4th Thursday of
// November"), NOT hardcoded dates. This works for any year, forever.
//
// Seasonal periods (spring break, summer peak) use fixed month/day ranges
// that are year-independent.
// =============================================================================

export interface HolidayMatch {
  name: string;
  intensity: number;  // 0-15
  daysUntil: number;  // positive = future, negative = past, 0 = on the day
}

// ---------------------------------------------------------------------------
// Holiday rule definitions
// ---------------------------------------------------------------------------

interface FixedHoliday {
  name: string;
  month: number;      // 1-12
  day: number;
  intensity: number;
  windowBefore: number;
  windowAfter: number;
}

interface NthDayHoliday {
  name: string;
  month: number;       // 1-12
  dayOfWeek: number;   // 0=Sun, 1=Mon, ..., 6=Sat
  nth: number;         // 1=first, 2=second, ... -1=last
  intensity: number;
  windowBefore: number;
  windowAfter: number;
}

interface SeasonalPeriod {
  name: string;
  startMonth: number; startDay: number;
  endMonth: number;   endDay: number;
  intensity: number;
}

type HolidayRule = FixedHoliday | NthDayHoliday;

// --- Fixed-date holidays (same date every year) ---
const FIXED_HOLIDAYS: FixedHoliday[] = [
  { name: "New Year's Day",   month: 1,  day: 1,  intensity: 12, windowBefore: 3, windowAfter: 1 },
  { name: 'Juneteenth',       month: 6,  day: 19, intensity: 5,  windowBefore: 1, windowAfter: 1 },
  { name: 'Independence Day', month: 7,  day: 4,  intensity: 12, windowBefore: 3, windowAfter: 2 },
  { name: 'Veterans Day',     month: 11, day: 11, intensity: 5,  windowBefore: 1, windowAfter: 1 },
  { name: 'Christmas',        month: 12, day: 25, intensity: 15, windowBefore: 4, windowAfter: 3 },
];

// --- Nth-weekday holidays (computed per year) ---
const NTH_DAY_HOLIDAYS: NthDayHoliday[] = [
  { name: 'MLK Jr. Day',     month: 1,  dayOfWeek: 1, nth: 3,  intensity: 6,  windowBefore: 2, windowAfter: 1 },
  { name: "Presidents' Day", month: 2,  dayOfWeek: 1, nth: 3,  intensity: 6,  windowBefore: 2, windowAfter: 1 },
  { name: 'Memorial Day',    month: 5,  dayOfWeek: 1, nth: -1, intensity: 10, windowBefore: 3, windowAfter: 1 },
  { name: 'Labor Day',       month: 9,  dayOfWeek: 1, nth: 1,  intensity: 10, windowBefore: 3, windowAfter: 1 },
  { name: 'Columbus Day',    month: 10, dayOfWeek: 1, nth: 2,  intensity: 5,  windowBefore: 2, windowAfter: 1 },
  { name: 'Thanksgiving',    month: 11, dayOfWeek: 4, nth: 4,  intensity: 15, windowBefore: 3, windowAfter: 2 },
];

// --- Seasonal periods (month/day ranges, same every year) ---
const SEASONAL_PERIODS: SeasonalPeriod[] = [
  { name: 'Spring Break',   startMonth: 3, startDay: 5,  endMonth: 4, endDay: 5,   intensity: 8 },
  { name: 'Summer Peak',    startMonth: 6, startDay: 15, endMonth: 8, endDay: 20,  intensity: 7 },
  { name: 'Holiday Season', startMonth: 12, startDay: 20, endMonth: 12, endDay: 31, intensity: 10 },
  // Jan 1-3 continuation of holiday season
  { name: 'Holiday Season', startMonth: 1, startDay: 1,  endMonth: 1, endDay: 3,   intensity: 10 },
];

// ---------------------------------------------------------------------------
// Date computation helpers
// ---------------------------------------------------------------------------

/** Get the nth occurrence of a weekday in a month, or last if nth = -1 */
function getNthWeekday(year: number, month: number, dayOfWeek: number, nth: number): Date {
  if (nth === -1) {
    // Last occurrence: start from last day of month, walk backwards
    const lastDay = new Date(year, month, 0); // day 0 of next month = last day of this month
    const diff = (lastDay.getDay() - dayOfWeek + 7) % 7;
    lastDay.setDate(lastDay.getDate() - diff);
    return lastDay;
  }

  // Nth occurrence: find first occurrence then add (nth-1) weeks
  const first = new Date(year, month - 1, 1);
  const diff = (dayOfWeek - first.getDay() + 7) % 7;
  first.setDate(1 + diff + (nth - 1) * 7);
  return first;
}

/** Compute the actual date for a holiday rule in a given year */
function getHolidayDate(rule: HolidayRule, year: number): Date {
  if ('day' in rule && !('dayOfWeek' in rule)) {
    return new Date(year, rule.month - 1, rule.day);
  }
  const r = rule as NthDayHoliday;
  return getNthWeekday(year, r.month, r.dayOfWeek, r.nth);
}

/** Days between two Dates (positive if b is after a) */
function daysDiff(a: Date, b: Date): number {
  const msA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const msB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((msB - msA) / 86400000);
}

// ---------------------------------------------------------------------------
// Main scoring function
// ---------------------------------------------------------------------------

export function getHolidayScore(date: Date): { score: number; match: HolidayMatch | null } {
  const year = date.getFullYear();

  let bestScore = 0;
  let bestMatch: HolidayMatch | null = null;

  function consider(name: string, intensity: number, daysUntil: number) {
    // Decay: full intensity on the day, -1 per day distance, floor at 50%
    const absDist = Math.abs(daysUntil);
    const score = Math.max(Math.ceil(intensity * 0.5), intensity - absDist);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = { name, intensity: score, daysUntil };
    }
  }

  // Check all holiday rules for this year (and adjacent years for window overlap)
  const allRules: HolidayRule[] = [...FIXED_HOLIDAYS, ...NTH_DAY_HOLIDAYS];

  for (const rule of allRules) {
    // Check this year and the one before/after (for window edge cases around Jan/Dec)
    for (const y of [year - 1, year, year + 1]) {
      const holidayDate = getHolidayDate(rule, y);
      const diff = daysDiff(date, holidayDate); // positive = holiday in future

      // Check if within the travel window
      const windowSize = diff >= 0 ? rule.windowBefore : rule.windowAfter;
      if (Math.abs(diff) <= windowSize) {
        consider(rule.name, rule.intensity, diff);
      }
    }
  }

  // Check seasonal periods
  const m = date.getMonth() + 1;
  const d = date.getDate();

  for (const period of SEASONAL_PERIODS) {
    const afterStart = m > period.startMonth || (m === period.startMonth && d >= period.startDay);
    const beforeEnd = m < period.endMonth || (m === period.endMonth && d <= period.endDay);

    if (afterStart && beforeEnd) {
      if (period.intensity > bestScore) {
        bestScore = period.intensity;
        bestMatch = { name: period.name, intensity: period.intensity, daysUntil: 0 };
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

  if (name === 'Spring Break') return 'Spring break window';
  if (name === 'Summer Peak') return 'Summer peak travel period';
  if (name === 'Holiday Season') return 'Holiday season travel corridor';

  if (MAJOR_HOLIDAYS.has(name)) {
    return `${name} travel week (DOT peak period)`;
  }

  return `${name} weekend`;
}
