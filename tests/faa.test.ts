import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock cache to avoid SQLite side effects
vi.mock('../server/cache.js', () => ({
  cacheGet: vi.fn().mockReturnValue(null),
  cacheSet: vi.fn(),
  cacheCleanup: vi.fn(),
}));

import { getAirportStatus, getAllActiveDelays, type FAAStatus } from '../server/faa.js';

// Sample FAA XML responses for testing
const SAMPLE_XML_GDP = `<AIRPORT_STATUS_INFORMATION>
<Update_Time>Sun Feb 22 01:39:17 2026 GMT</Update_Time>
<Delay_type><Name>Ground Delay Programs</Name>
<Ground_Delay_List>
<Ground_Delay><ARPT>EWR</ARPT><Reason>wind</Reason><Avg>45 minutes</Avg><Max>2 hours</Max></Ground_Delay>
<Ground_Delay><ARPT>SFO</ARPT><Reason>fog</Reason><Avg>1 hour</Avg><Max>3 hours</Max></Ground_Delay>
</Ground_Delay_List>
</Delay_type>
<Delay_type><Name>Ground Stops</Name>
<Ground_Stop_List>
<Program><ARPT>ORD</ARPT><Reason>thunderstorms</Reason><End_Time>15:00 UTC</End_Time></Program>
</Ground_Stop_List>
</Delay_type>
<Delay_type><Name>Airport Closures</Name>
<Airport_Closure_List>
<Airport><ARPT>SAN</ARPT><Reason>construction</Reason><Start>Jan 12</Start><Reopen>Mar 19</Reopen></Airport>
</Airport_Closure_List>
</Delay_type>
</AIRPORT_STATUS_INFORMATION>`;

const SAMPLE_XML_EMPTY = `<AIRPORT_STATUS_INFORMATION>
<Update_Time>Sun Feb 22 01:39:17 2026 GMT</Update_Time>
</AIRPORT_STATUS_INFORMATION>`;

describe('FAA Airport Status', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('parses Ground Delay Program correctly', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(SAMPLE_XML_GDP, { status: 200, headers: { 'Content-Type': 'text/xml' } })
    );

    const status = await getAirportStatus('EWR');
    expect(status).not.toBeNull();
    expect(status!.delay).toBe(true);
    expect(status!.delayType).toBe('GDP');
    expect(status!.reason).toContain('wind');
    expect(status!.avgDelay).toBe('45 minutes');
  });

  it('parses Ground Stop correctly', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(SAMPLE_XML_GDP, { status: 200, headers: { 'Content-Type': 'text/xml' } })
    );

    const status = await getAirportStatus('ORD');
    expect(status).not.toBeNull();
    expect(status!.delay).toBe(true);
    expect(status!.delayType).toBe('GS');
    expect(status!.reason).toContain('thunderstorms');
  });

  it('parses Closure correctly', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(SAMPLE_XML_GDP, { status: 200, headers: { 'Content-Type': 'text/xml' } })
    );

    const status = await getAirportStatus('SAN');
    expect(status).not.toBeNull();
    expect(status!.delay).toBe(true);
    expect(status!.delayType).toBe('CLOSURE');
  });

  it('returns no delay for airport not in feed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(SAMPLE_XML_GDP, { status: 200, headers: { 'Content-Type': 'text/xml' } })
    );

    const status = await getAirportStatus('ATL');
    expect(status).not.toBeNull();
    expect(status!.delay).toBe(false);
    expect(status!.delayType).toBeUndefined();
  });

  it('returns no delay when FAA returns empty feed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(SAMPLE_XML_EMPTY, { status: 200, headers: { 'Content-Type': 'text/xml' } })
    );

    const status = await getAirportStatus('ATL');
    expect(status).not.toBeNull();
    expect(status!.delay).toBe(false);
  });

  it('gracefully handles FAA API failure (no crash, returns no-delay)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network failure'));

    const status = await getAirportStatus('ATL');
    expect(status).not.toBeNull();
    expect(status!.airport).toBe('ATL');
    expect(status!.delay).toBe(false);
  });

  it('gracefully handles FAA 500 error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Internal Server Error', { status: 500 })
    );

    const status = await getAirportStatus('ATL');
    expect(status).not.toBeNull();
    expect(status!.delay).toBe(false);
  });

  it('gracefully handles malformed XML', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('<html><body>Not XML</body></html>', { status: 200 })
    );

    const status = await getAirportStatus('ATL');
    expect(status).not.toBeNull();
    // Should not crash — returns no-delay
    expect(status!.delay).toBe(false);
  });

  it('getAllActiveDelays returns map of all delayed airports', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(SAMPLE_XML_GDP, { status: 200, headers: { 'Content-Type': 'text/xml' } })
    );

    const delays = await getAllActiveDelays();
    expect(delays.size).toBe(4); // EWR (GDP), SFO (GDP), ORD (GS), SAN (CLOSURE)

    const ewr = delays.get('EWR');
    expect(ewr).toBeDefined();
    expect(ewr!.delayType).toBe('GDP');

    const ord = delays.get('ORD');
    expect(ord).toBeDefined();
    expect(ord!.delayType).toBe('GS');
  });

  it('getAllActiveDelays returns empty map on FAA failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('timeout'));

    const delays = await getAllActiveDelays();
    expect(delays.size).toBe(0);
  });

  it('Ground Stop takes priority over GDP for same airport', async () => {
    // Build XML where ORD has both a Ground Stop AND a GDP
    const xml = `<AIRPORT_STATUS_INFORMATION>
<Delay_type><Name>Ground Stops</Name>
<Ground_Stop_List>
<Program><ARPT>ORD</ARPT><Reason>thunderstorms</Reason><End_Time>15:00 UTC</End_Time></Program>
</Ground_Stop_List>
</Delay_type>
<Delay_type><Name>Ground Delay Programs</Name>
<Ground_Delay_List>
<Ground_Delay><ARPT>ORD</ARPT><Reason>volume</Reason><Avg>30 minutes</Avg><Max>1 hour</Max></Ground_Delay>
</Ground_Delay_List>
</Delay_type>
</AIRPORT_STATUS_INFORMATION>`;

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(xml, { status: 200, headers: { 'Content-Type': 'text/xml' } })
    );

    const status = await getAirportStatus('ORD');
    expect(status!.delayType).toBe('GS'); // Ground Stop is checked first
  });
});
