# BTS Data Sources — Real Datasets

All data in this directory is downloaded from official US DOT sources. **No fabricated numbers.**

## 1. Involuntary Denied Boarding (`bts_involuntary_denied_boarding.csv`)

- **Source:** DOT / data.transportation.gov
- **Dataset:** "Commercial Aviation - Involuntary Denied Boarding"
- **Socrata ID:** `xyfb-hgtv`
- **Download URL:** https://data.transportation.gov/api/views/xyfb-hgtv/rows.csv?accessType=DOWNLOAD
- **Records:** 899 rows, quarterly data by carrier, 2010–2021
- **Fields used:** `MKT_CARRIER`, `TOT_BOARDING`, `TOT_DEN_BOARDING`, `COMP_PAID_1/2/3`, `YEAR`, `QUARTER`
- **What we compute from it:**
  - Carrier IDB rates (per 10,000 enplanements)
  - Average compensation per IDB event
  - Quarterly trends (boarding totals, IDB counts, compensation)
  - Top oversold carrier rankings

## 2. T-100 Domestic Airports 2024 (`bts_t100_airports_2024.csv`)

- **Source:** DOT BTS / ArcGIS FeatureServer
- **Dataset:** "T-100 Domestic Market and Segment Data" (Layer 1)
- **Query URL:** https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/T100_Domestic_Market_and_Segment_Data/FeatureServer/1/query?where=year%3D2024&outFields=*&orderByFields=passengers+DESC&resultRecordCount=500&f=json
- **DOI:** https://doi.org/10.21949/1528019
- **Records:** 500 airports, 2024 annual data
- **Fields used:** `origin`, `passengers`, `departures`
- **What we compute from it:**
  - Airport-level load factor estimates (passengers / departures / avg_seats)
  - Route-level load factors (average of origin + dest airport LFs)
  - Daily departure frequency estimates for schedule generation
  - Route importance ranking by passenger volume

## 3. Weather Data (live)

- **Source:** aviationweather.gov METAR/TAF service (FAA/NWS)
- **URL:** https://aviationweather.gov/api/data/metar
- **Refresh:** Real-time, cached 15 minutes
- **Handled in:** `server/weather.ts`

## Known Limitations

- **VDB (Voluntary Denied Boarding):** Not available in the public IDB dataset. Estimated at ~3× IDB based on published DOT Air Travel Consumer Report ratios.
- **Route-level denied boarding:** BTS only publishes carrier-level IDB data, not per-route. Top oversold routes are estimated from carrier IDB rates applied to fortress hub routes.
- **T-100 segment data:** Full carrier+origin+dest+seats data requires form-based download from transtats.bts.gov (not programmatically accessible). We use the airport-level aggregate data from the ArcGIS endpoint.
- **Load factors:** Carrier-specific load factors use published BTS Form 41 Schedule T-2 values for 2019. Route-level LFs are derived from T-100 airport passenger/departure ratios.
