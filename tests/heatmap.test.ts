import { describe, it, expect } from 'vitest';
import { buildHeatmap } from '../server/heatmap.js';

describe('Best Day to Fly heatmap', () => {
  it('builds the expected number of days', () => {
    const days = buildHeatmap('ATL', 'LGA', 2);
    expect(days.length).toBe(14);
  });

  it('includes predicted scores and factor details', () => {
    const days = buildHeatmap('ATL', 'LGA', 1);
    expect(days.length).toBe(7);
    const first = days[0];
    expect(first.predictedScore).toBeGreaterThanOrEqual(5);
    expect(first.predictedScore).toBeLessThanOrEqual(100);
    expect(first.factors.length).toBeGreaterThan(0);
    expect(first.factors.some(f => f.name === 'Carrier Rate')).toBe(true);
  });
});
