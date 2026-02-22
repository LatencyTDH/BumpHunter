import { describe, it, expect } from 'vitest';
import {
  isLastFlightOfDay,
  findNextFlightTime,
  calculateRebookingDelay,
  getCompensationTier,
  calculateCompensation,
  estimateFare,
  getRouteDistance,
} from '../server/compensation.js';

describe('isLastFlightOfDay', () => {
  it('returns true when flight at 9 PM is the last one (no later flights)', () => {
    const allTimes = ['06:00', '09:30', '14:00', '21:00'];
    expect(isLastFlightOfDay('21:00', allTimes)).toBe(true);
  });

  it('returns false when 3 PM flight has a 6 PM flight on same route', () => {
    const allTimes = ['06:00', '09:30', '15:00', '18:00', '21:00'];
    expect(isLastFlightOfDay('15:00', allTimes)).toBe(false);
  });

  it('returns true for a single flight on the route', () => {
    expect(isLastFlightOfDay('14:00', ['14:00'])).toBe(true);
  });

  it('returns false for the first flight of the day', () => {
    const allTimes = ['06:00', '10:00', '18:00'];
    expect(isLastFlightOfDay('06:00', allTimes)).toBe(false);
  });

  it('handles flights at the same time (not "later")', () => {
    const allTimes = ['12:00', '12:00', '18:00'];
    expect(isLastFlightOfDay('12:00', allTimes)).toBe(false);
    expect(isLastFlightOfDay('18:00', allTimes)).toBe(true);
  });
});

describe('findNextFlightTime', () => {
  it('finds the next available flight', () => {
    const allTimes = ['06:00', '09:30', '15:00', '18:00', '21:00'];
    expect(findNextFlightTime('15:00', allTimes)).toBe('18:00');
  });

  it('returns null for the last flight', () => {
    const allTimes = ['06:00', '09:30', '21:00'];
    expect(findNextFlightTime('21:00', allTimes)).toBeNull();
  });

  it('finds the closest next flight', () => {
    const allTimes = ['06:00', '10:00', '14:00', '18:00', '22:00'];
    expect(findNextFlightTime('10:00', allTimes)).toBe('14:00');
  });
});

describe('calculateRebookingDelay', () => {
  it('returns 24 hours for last flight of day', () => {
    expect(calculateRebookingDelay('21:00', null, 120)).toBe(24);
  });

  it('calculates delay between flights correctly', () => {
    expect(calculateRebookingDelay('15:00', '18:00', 120)).toBe(3);
  });

  it('returns 0 for same-time flights', () => {
    expect(calculateRebookingDelay('15:00', '15:00', 120)).toBe(0);
  });
});

describe('getCompensationTier', () => {
  it('returns no compensation for <1hr delay', () => {
    const r = getCompensationTier(0.5);
    expect(r.tier).toBe('none');
    expect(r.maxAmount).toBe(0);
  });

  it('returns 200% tier for 1-2hr delay', () => {
    const r = getCompensationTier(1.5);
    expect(r.tier).toBe('200pct');
    expect(r.maxAmount).toBe(775);
    expect(r.multiplier).toBe(2);
  });

  it('returns 400% tier for 2+hr delay', () => {
    const r = getCompensationTier(2.5);
    expect(r.tier).toBe('400pct');
    expect(r.maxAmount).toBe(1550);
    expect(r.multiplier).toBe(4);
  });

  it('returns 400% tier for exactly 2hr delay', () => {
    expect(getCompensationTier(2.0).tier).toBe('400pct');
  });

  it('returns 200% tier for exactly 1hr delay', () => {
    expect(getCompensationTier(1.0).tier).toBe('200pct');
  });
});

describe('calculateCompensation', () => {
  it('calculates 400% tier for last flight of day (next flight tomorrow)', () => {
    const allTimes = ['06:00', '12:00', '21:00'];
    const r = calculateCompensation('ATL', 'LGA', '21:00', allTimes, 145);
    expect(r.lastFlightOfDay).toBe(true);
    expect(r.nextFlightDepTime).toBeNull();
    expect(r.tier).toBe('400pct');
    expect(r.maxCompensation).toBe(1550);
    expect(r.compensationDisplay).toContain('1,550');
  });

  it('calculates 200% tier for 1-2hr rebooking delay', () => {
    const allTimes = ['06:00', '15:00', '16:30'];
    const r = calculateCompensation('ATL', 'LGA', '15:00', allTimes, 145);
    expect(r.lastFlightOfDay).toBe(false);
    expect(r.nextFlightDepTime).toBe('16:30');
    expect(r.tier).toBe('200pct');
    expect(r.maxCompensation).toBe(775);
  });

  it('calculates no compensation for quick rebooking (<1hr gap)', () => {
    const allTimes = ['06:00', '15:00', '15:30'];
    const r = calculateCompensation('ATL', 'LGA', '15:00', allTimes, 145);
    expect(r.lastFlightOfDay).toBe(false);
    expect(r.tier).toBe('none');
    expect(r.maxCompensation).toBe(0);
  });

  it('calculates 400% for 2+hr delay between flights', () => {
    const allTimes = ['10:00', '15:00'];
    const r = calculateCompensation('ATL', 'LGA', '10:00', allTimes, 145);
    expect(r.lastFlightOfDay).toBe(false);
    expect(r.tier).toBe('400pct');
    expect(r.maxCompensation).toBe(1550);
  });
});

describe('estimateFare', () => {
  it('estimates fare for known route', () => {
    const fare = estimateFare('ATL', 'LGA');
    expect(fare).toBeGreaterThan(50);
    expect(fare).toBeLessThan(200);
  });

  it('returns minimum $100 for very short routes', () => {
    expect(estimateFare('LGA', 'DCA')).toBeGreaterThanOrEqual(100);
  });
});

describe('getRouteDistance', () => {
  it('returns distance for known route', () => {
    expect(getRouteDistance('ATL', 'LGA')).toBe(762);
  });

  it('returns distance regardless of direction', () => {
    expect(getRouteDistance('LGA', 'ATL')).toBe(762);
  });

  it('returns default for unknown route', () => {
    expect(getRouteDistance('XXX', 'YYY')).toBe(800);
  });
});
