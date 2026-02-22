import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock cache to avoid SQLite side effects in weather tests
vi.mock('../server/cache.js', () => ({
  cacheGet: vi.fn().mockReturnValue(null),
  cacheSet: vi.fn(),
  cacheCleanup: vi.fn(),
}));

import { getWeatherSeverity, getWeatherAlerts, type MetarData } from '../server/weather.js';

function makeMockMetar(overrides: Partial<MetarData> = {}): MetarData {
  return {
    icaoId: 'KATL',
    name: 'Hartsfield-Jackson Atlanta Intl',
    rawOb: 'KATL 211856Z 27010KT 10SM FEW250 25/10 A3002',
    temp: 25,
    dewp: 10,
    wdir: 270,
    wspd: 10,
    wgst: null,
    visib: '10',
    wxString: null,
    clouds: [],
    fltcat: 'VFR',
    reportTime: new Date().toISOString(),
    ...overrides,
  };
}

describe('Weather Parsing & Severity', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('thunderstorms produce severe severity (score 25)', async () => {
    const metar = makeMockMetar({ wxString: 'TS', fltcat: 'VFR' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify([metar]), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );

    const result = await getWeatherSeverity('ATL');
    expect(result.score).toBe(25);
    expect(result.reason).toContain('Thunderstorms');
  });

  it('low visibility (LIFR) produces severe severity', async () => {
    const metar = makeMockMetar({ visib: '0.25', fltcat: 'LIFR', wxString: 'FG' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify([metar]), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );

    const result = await getWeatherSeverity('ATL');
    expect(result.score).toBe(25);
    expect(result.reason).toContain('LIFR');
  });

  it('high winds produce moderate severity (score 15)', async () => {
    const metar = makeMockMetar({ wspd: 32, wgst: 40 });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify([metar]), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );

    const result = await getWeatherSeverity('ATL');
    expect(result.score).toBe(15);
    expect(result.reason).toContain('High Winds');
  });

  it('clear weather returns score 0', async () => {
    const metar = makeMockMetar(); // VFR, no wx, light winds
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify([metar]), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );

    const result = await getWeatherSeverity('ATL');
    expect(result.score).toBe(0);
    expect(result.reason).toBeNull();
  });

  it('severity classification: severe > moderate > minor', async () => {
    // Severe (thunderstorms)
    const severeMet = makeMockMetar({ icaoId: 'KATL', wxString: '+TSRA', fltcat: 'IFR' });
    // Moderate (IFR, low vis)
    const moderateMet = makeMockMetar({ icaoId: 'KDFW', visib: '2', fltcat: 'IFR' });
    // Minor (MVFR)
    const minorMet = makeMockMetar({ icaoId: 'KEWR', visib: '4', fltcat: 'MVFR' });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify([severeMet, moderateMet, minorMet]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const alerts = await getWeatherAlerts(['ATL', 'DFW', 'EWR']);

    // Should be sorted severe first
    expect(alerts.length).toBeGreaterThanOrEqual(2);
    if (alerts.length >= 2) {
      const severityOrder: Record<string, number> = { severe: 0, moderate: 1, minor: 2 };
      for (let i = 1; i < alerts.length; i++) {
        expect(severityOrder[alerts[i].severity]).toBeGreaterThanOrEqual(
          severityOrder[alerts[i - 1].severity]
        );
      }
    }
  });
});
