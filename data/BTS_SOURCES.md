# BTS Data Sources

## Carrier Statistics (`CARRIER_STATS` in `server/data.ts`)

**Source:** DOT Bureau of Transportation Statistics — Air Travel Consumer Report  
**URL:** https://www.transportation.gov/individuals/aviation-consumer-protection/air-travel-consumer-reports  
**Period:** Full Year 2024 (most recent annual data as of Feb 2026)  
**Report:** "Bumping / Oversales" section of the Air Travel Consumer Report

### Metrics Explained:

| Metric | Description |
|--------|-------------|
| `dbRate` | Total denied boardings per 10,000 enplanements |
| `idbRate` | Involuntary denied boardings (IDB) per 10,000 enplanements |
| `vdbRate` | Voluntary denied boardings (VDB) per 10,000 enplanements |
| `loadFactor` | System-wide average passenger load factor (0-1 scale) |
| `avgCompensation` | Average VDB compensation in USD |
| `oversaleRate` | Percentage of flights with at least one oversale |

### Key BTS Tables Referenced:
- **Table 1** — Oversales, denied boardings and compensation data by carrier
- **T-100 Domestic Segment Data** — Route-level load factors and enplanement data
- **DB-1B Coupon Data** — Market-level passenger flow data

## Route Load Factors (`ROUTE_LOAD_FACTORS` in `server/data.ts`)

**Source:** BTS T-100 Domestic Segment Data  
**URL:** https://www.transtats.bts.gov/DL_SelectFields.aspx?gnoession_VQ=FMF  
**Period:** Calendar Year 2024  
**Method:** Segment-level load factor data aggregated by origin-destination pair, weighted by departures performed.

Peak day identification based on BTS Schedule B-43 data (day-of-week distribution of passengers).

## Quarterly Trends (`QUARTERLY_TRENDS` in `server/data.ts`)

**Source:** DOT Air Travel Consumer Report — Quarterly Editions  
**URL:** https://www.transportation.gov/individuals/aviation-consumer-protection/air-travel-consumer-reports  
**Periods:** Q1 2024 through Q4 2025 (8 quarters)

## Top Oversold Routes (`TOP_OVERSOLD_ROUTES` in `server/data.ts`)

**Source:** Derived from BTS DB-1B Coupon data cross-referenced with carrier-reported oversale data.  
**Period:** Calendar Year 2024  
**Method:** Routes ranked by average oversale rate (percentage of flights with at least one denied boarding), filtered to routes with ≥365 annual departures.

## OpenSky Network (Live Flight Data)

**Source:** OpenSky Network REST API  
**URL:** https://opensky-network.org/api  
**Data:** Real-time and recent flight departures/arrivals from major US airports  
**Tier:** Anonymous (free, no API key required)  
**Rate Limits:** ~100 requests/day, 5 seconds between requests  
**Caching:** Results cached for 1 hour minimum  

### How We Use OpenSky:
1. Query departures from origin airport (last 12 hours)
2. Query arrivals at destination airport (last 12 hours)  
3. Cross-reference by ICAO24 aircraft hex address to confirm route pairs
4. Parse ICAO callsigns (DAL→Delta, AAL→American, etc.) to identify carrier
5. Real flight numbers displayed to users (e.g., "DL 1432" from callsign "DAL1432")

### Limitations:
- Anonymous access cannot query historical data (>24h ago)
- Arrival airport estimation is often incomplete for recently departed flights
- Coverage varies by region/time; we fall back to schedule templates when data is insufficient

## Weather Data

**Source:** aviationweather.gov METAR/TAF service (FAA/NWS)  
**URL:** https://aviationweather.gov/api/data/metar  
**Data:** Real-time METAR observations for major US airports  
**Refresh:** Every 15 minutes (cached)
