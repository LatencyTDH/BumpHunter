import { describe, it, expect } from 'vitest';
import { getHolidayScore, formatHolidayTag } from '../server/holidays.js';

describe('Holiday/Event Calendar Scoring', () => {
  // =========================================================================
  // Core scoring tests (required by spec)
  // =========================================================================

  it('Thanksgiving Wednesday 2026 → high score', () => {
    // Thanksgiving 2026 = Nov 26 (Thursday). Nov 25 = Wednesday = 1 day before.
    // travelWindowBefore = 3, intensity = 15 → score = 15 - 1 = 14
    const date = new Date('2026-11-25T12:00:00');
    const result = getHolidayScore(date);
    expect(result.score).toBeGreaterThanOrEqual(13);
    expect(result.match).not.toBeNull();
    expect(result.match!.name).toBe('Thanksgiving');
    expect(result.match!.daysUntil).toBe(1); // holiday is tomorrow
  });

  it('Random Tuesday Feb 11 2026 → zero', () => {
    // Feb 11, 2026: Presidents' Day is Feb 16 (5 days away, window=2) → no match
    // Super Bowl LX is Feb 8 (3 days ago, afterWindow=1) → no match
    const date = new Date('2026-02-11T12:00:00');
    const result = getHolidayScore(date);
    expect(result.score).toBe(0);
    expect(result.match).toBeNull();
  });

  it('Christmas Eve → high score', () => {
    // Christmas 2026 = Dec 25. Dec 24 = 1 day before.
    // travelWindowBefore = 4, intensity = 15 → score = 15 - 1 = 14
    const date = new Date('2026-12-24T12:00:00');
    const result = getHolidayScore(date);
    expect(result.score).toBeGreaterThanOrEqual(13);
    expect(result.match).not.toBeNull();
    expect(result.match!.name).toBe('Christmas');
  });

  it('Spring break mid-March → medium score', () => {
    // March 15, 2026 is within Spring Break range (Mar 7 - Mar 29)
    // Period intensity = 8
    const date = new Date('2026-03-15T12:00:00');
    const result = getHolidayScore(date);
    expect(result.score).toBeGreaterThanOrEqual(7);
    expect(result.score).toBeLessThanOrEqual(10);
    expect(result.match).not.toBeNull();
    expect(result.match!.name).toBe('Spring Break');
  });

  // =========================================================================
  // Additional coverage
  // =========================================================================

  it('Thanksgiving Day itself → max intensity (15)', () => {
    const date = new Date('2026-11-26T12:00:00');
    const result = getHolidayScore(date);
    expect(result.score).toBe(15);
    expect(result.match!.name).toBe('Thanksgiving');
    expect(result.match!.daysUntil).toBe(0);
  });

  it('Christmas Day 2025 → max intensity (15)', () => {
    const date = new Date('2025-12-25T12:00:00');
    const result = getHolidayScore(date);
    expect(result.score).toBe(15);
    expect(result.match!.name).toBe('Christmas');
  });

  it('Memorial Day weekend 2026 → high score', () => {
    // Memorial Day 2026 = May 25 (Monday). The Saturday before = May 23.
    // travelWindowBefore = 3, intensity = 10 → score = 10 - 2 = 8
    const date = new Date('2026-05-23T12:00:00');
    const result = getHolidayScore(date);
    expect(result.score).toBeGreaterThanOrEqual(8);
    expect(result.match!.name).toBe('Memorial Day');
  });
  it("New Year's Day 2026 → high score", () => {
    const date = new Date('2026-01-01T12:00:00');
    const result = getHolidayScore(date);
    // New Year's Day has intensity 12. Also within Holiday Season (intensity 10).
    // New Year's wins with 12.
    expect(result.score).toBe(12);
    expect(result.match!.name).toBe("New Year's Day");
  });

  it('Summer peak July 2026 → moderate score', () => {
    const date = new Date('2026-07-15T12:00:00');
    const result = getHolidayScore(date);
    expect(result.score).toBe(7);
    expect(result.match!.name).toBe('Summer Peak');
  });

  it('Outside all windows → zero', () => {
    // April 15, 2026: outside spring break (ends Mar 29), no holiday nearby
    const date = new Date('2026-04-15T12:00:00');
    const result = getHolidayScore(date);
    expect(result.score).toBe(0);
    expect(result.match).toBeNull();
  });

  it('Holiday season corridor (Dec 29) → covered', () => {
    // Dec 29, 2026: 4 days after Christmas, outside Christmas after-window (3 days).
    // But within Holiday Season period (Dec 20 - Jan 3, intensity 10).
    const date = new Date('2026-12-29T12:00:00');
    const result = getHolidayScore(date);
    expect(result.score).toBeGreaterThanOrEqual(10);
    expect(result.match).not.toBeNull();
  });

  it('Super Bowl weekend 2026 → event match', () => {
    // Super Bowl LX = Feb 8, 2026. Feb 6 = 2 days before.
    // travelWindowBefore = 4, intensity = 10 → score = 10 - 2 = 8
    const date = new Date('2026-02-06T12:00:00');
    const result = getHolidayScore(date);
    expect(result.score).toBeGreaterThanOrEqual(8);
    expect(result.match!.name).toBe('Super Bowl LX');
  });

  // =========================================================================
  // Tag formatting
  // =========================================================================

  it('formatHolidayTag produces correct tags', () => {
    expect(formatHolidayTag({ name: 'Thanksgiving', intensity: 15, daysUntil: 0 }))
      .toBe('Thanksgiving travel week (DOT peak period)');

    expect(formatHolidayTag({ name: 'Spring Break', intensity: 8, daysUntil: 0 }))
      .toBe('Spring break window');

    expect(formatHolidayTag({ name: 'Super Bowl LX', intensity: 10, daysUntil: 2 }))
      .toBe('Super Bowl LX travel surge');

    expect(formatHolidayTag({ name: 'MLK Jr. Day', intensity: 6, daysUntil: 1 }))
      .toBe('MLK Jr. Day weekend');

    expect(formatHolidayTag({ name: 'Summer Peak', intensity: 7, daysUntil: 0 }))
      .toBe('Summer peak travel period');
  });
});
