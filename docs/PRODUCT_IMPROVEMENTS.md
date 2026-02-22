# BumpHunter Product Improvements

> Comprehensive proposals organized by tier. Every idea uses free data sources. No vaporware.

---

## Tier 0 — Critical (Fix Before Anything Else)

### 0.1 Holiday / Event Calendar Signal
**What:** Add a holiday/event factor to scoring. Federal holidays, spring break windows, Thanksgiving week, Christmas, major sporting events (Super Bowl, March Madness host cities), and college move-in weekends all cause massive demand spikes that directly drive overbooking.

**Why it matters:** The current scoring has zero awareness of whether a flight is on Thanksgiving Wednesday (the single busiest travel day) or a random Tuesday in February. This is arguably the biggest missing signal — holidays cause the largest load factor spikes and are 100% predictable.

**Data source:**
- US federal holidays: hardcode the ~11 dates per year, trivial
- School break windows: scrape or hardcode major district calendars (NYC, LA, Chicago)
- Sporting events: Wikipedia lists of Super Bowl, NCAA Final Four, major marathon host cities — can be a static JSON updated yearly
- Conference season: CES (LAS, Jan), SXSW (AUS, Mar), etc. — static list

**Scoring integration:** New factor: `Season/Holiday` (0-15 pts). Replace the current missing seasonality. Thanksgiving week = 15, Christmas week = 13, summer Fridays = 10, spring break = 10, regular = 0-3.

**Effort:** S (static JSON + scoring factor)
**Priority:** P0

---

### 0.2 Load Factor / Seat Availability Signal
**What:** Query airline seat maps to detect flights that are nearly full. A flight showing 3 remaining middle seats on a 175-seat plane is infinitely more likely to seek VDB volunteers than one showing 40 open seats.

**Why it matters:** This is the single strongest real-time predictor of an oversold flight. Everything else in the model is a proxy for "is this flight full?" — seat map data IS the answer.

**Data source:**
- Google Flights shows seat availability indicators (free, via scraping or the ITA Matrix)
- Airline mobile sites expose seat maps without login: `united.com/ual/en/us/flight-search/book-a-flight/seatmap`, `delta.com` seat map viewer
- ExpertFlyer alternative: some data leaks through Google Flights API responses
- Approach: headless browser → hit seat map endpoint → count available seats

**Scoring integration:** New factor: `Seat Availability` (0-25 pts). <5% open = 25, <10% = 20, <20% = 12, >30% = 0. This should be the HIGHEST-weighted factor and would replace or supplement aircraft size.

**Effort:** L (requires browser automation or reverse-engineering airline seat map APIs)
**Priority:** P0 — this transforms the product from "educated guess" to "actually knows which flights are full"

---

### 0.3 BTS On-Time Performance Data
**What:** Integrate BTS on-time performance data to identify chronically delayed routes. Flights with poor OTP are more likely to have misconnecting passengers piling onto the next flight.

**Why it matters:** When UA 1234 ORD→SFO runs 45 min late 40% of the time, the next ORD→SFO departure gets flooded with rebooking requests. Chronic delays are a leading cause of oversales that the current model completely ignores.

**Data source:**
- BTS Airline On-Time Performance: `https://www.transtats.bts.gov/DL_SelectFields.aspx?gnoession_VarName=OTP` — free CSV download, monthly, per-flight-number granularity
- Fields: `CARRIER_DELAY`, `ARR_DELAY`, `CANCELLED`, `DIVERTED`
- Can pre-process into a route-level "reliability score"

**Scoring integration:** Add `Route Reliability` factor (0-10 pts). Routes with >25% delay rate get 8-10 pts (downstream flights on same route get oversold). Specific flight numbers with chronic delays get bonus points.

**Effort:** M (download + parse CSVs, build route reliability index)
**Priority:** P0

---

## Tier 1 — High Impact

### 1.1 Connecting Flight Cascade Analysis
**What:** When weather hits a hub (e.g., thunderstorms at ORD), identify which DOWNSTREAM flights from that hub will get flooded with rebooking passengers. If 15 ORD→SFO flights cancel, the surviving ORD→SFO flights become gold mines.

**Why it matters:** The current weather scoring only adds points to flights AT the affected airport. The real money is on the flights AFTER the weather clears — the surviving departures that absorb all the rebookings from cancelled flights. This is how experienced bump hunters actually operate.

**Data source:**
- Already have: FR24 schedule data (all departures from hub)
- Already have: weather severity per hub
- New logic: when weather severity ≥ "moderate" at hub X, boost scores for ALL flights departing hub X in the 4-8 hour window after the weather event, weighted by how many parallel flights exist on the same route (fewer alternatives = higher boost)

**Scoring integration:** New `Cascade Boost` (0-15 pts). When a hub has active severe weather, all flights on high-frequency routes departing 2-8 hours later get boosted. Single-daily-frequency routes get maximum boost (no alternative for rebooking).

**Effort:** M (logic layer on existing weather + schedule data)
**Priority:** P1

---

### 1.2 Push Alerts / Route Monitoring
**What:** Let users save routes and get notified when conditions align for a high-score opportunity. "Watch ATL→LGA on Sundays" → push notification when weather + timing + carrier data pushes a flight above threshold.

**Why it matters:** Currently users have to manually check. The highest-value opportunities (weather cascades) are time-sensitive and gone in hours. A user who gets a push at 2 PM about thunderstorms hitting ORD can book an evening ORD flight and volunteer.

**Data source:** All existing — just needs a monitoring loop.

**Implementation:**
- Backend: cron job every 15 min checks saved routes against weather + scoring
- Storage: SQLite table for watched routes + alert thresholds
- Delivery: Web Push API (free, works on mobile Safari via PWA), or Telegram bot (free)
- PWA: add `manifest.json` + service worker for installable app + push notifications

**Effort:** M (backend monitoring loop + Web Push / Telegram integration)
**Priority:** P1

---

### 1.3 "Best Day to Fly" Heatmap
**What:** For a given route, show a 4-week calendar heatmap of predicted bump scores per day. User sees that Sunday 3/8 scores 72 but Wednesday 3/11 scores 31 — books Sunday.

**Why it matters:** Users currently search one date at a time. The whole point is strategic booking — you CHOOSE which day to fly. A heatmap makes the optimal day obvious at a glance.

**Data source:**
- Day-of-week scoring (already have)
- Holiday calendar (proposal 0.1)
- Historical weather patterns (seasonal averages — can use NOAA climate normals, free)
- Carrier DB rates (already have)
- No real-time data needed for future dates — this is a predictive model

**Implementation:** New API endpoint: `GET /api/flights/heatmap?origin=ATL&dest=LGA&weeks=4`. Returns array of `{date, predictedScore, factors}`. Frontend renders as a color-coded calendar grid.

**Effort:** M (new endpoint + UI component)
**Priority:** P1

---

### 1.4 Multi-City / Flexible Search
**What:** "I'm in ATL. Show me the best bump opportunity to ANY destination this weekend." Or: "Show me ATL→anywhere on Sunday, sorted by score."

**Why it matters:** Power users don't care WHERE they fly — they care about getting bumped. Locking to a single origin→dest misses the best opportunities. An ATL→MCO at score 45 is irrelevant when ATL→LGA is at 82.

**Data source:** FR24 schedule API already returns ALL departures from an airport. We just need to score all of them instead of filtering to one destination.

**Implementation:**
- New search mode: origin only (dest = "ANY" or blank)
- Score all departures from that origin on that date
- Return top 20 by bump score
- UI: toggle between "specific route" and "best opportunities from [origin]"

**Effort:** S-M (FR24 data already fetched per-airport; scoring just needs to loop all destinations)
**Priority:** P1

---

### 1.5 Compensation Calculator & DOT Rules Engine
**What:** Show exact DOT-mandated compensation for each flight based on the specific rebooking scenario. "If bumped from DL 323 ATL→LGA dep 5PM and rebooked to 9PM same day: $775 (200% of one-way fare, DOT minimum for 1-2hr delay on domestic)."

**Why it matters:** Users don't know what they're entitled to. The DOT has specific rules:
- **0-1 hour delay:** no compensation required
- **1-2 hour delay (domestic):** 200% of one-way fare, max $775
- **2+ hour delay (domestic):** 400% of one-way fare, max $1,550
- Cash OR check required if passenger demands it (vouchers only if passenger agrees)

Showing the exact dollar amount per flight makes the value proposition concrete and helps users negotiate.

**Data source:**
- DOT 14 CFR 250.5 — the actual regulation (static rules, hardcode)
- Fare estimates: Google Flights scraping for average one-way fare on route, or use a fare range lookup (ITA Matrix)
- Rebooking options: next available flight time from FR24 schedule (already have this data!)

**Implementation:**
- For each scored flight, calculate: "If bumped, next available flight is [X]. Delay = [Y hours]. DOT minimum compensation = $[Z]."
- Show as a prominent field on each flight card

**Effort:** M (DOT rules are simple math; fare estimation is the harder part)
**Priority:** P1

---

### 1.6 Operating Carrier Detection Enhancement
**What:** The current system correctly scores by operating carrier when FR24 provides it. But for future scheduled flights, the operating carrier is often unknown at booking time. Cross-reference with DOT DB1B Coupon data to build a lookup: "AA flights on ATL→LGA are 73% operated by PSA Airlines (OH)."

**Why it matters:** Operating carrier makes a HUGE scoring difference. PSA (OH) has IDB rate of 1.26/10k vs American mainline at 0.49/10k. A user sees "American Airlines" but it's actually a PSA CRJ-900 — completely different bump profile. Surfacing this preemptively is valuable.

**Data source:**
- BTS DB1B Coupon data (free): has operating_carrier vs. ticketing_carrier per route
- Can pre-compute a static lookup: `{route, marketing_carrier} → {operating_carrier, probability}`
- Update quarterly when BTS publishes new data

**Effort:** M (data processing + lookup integration)
**Priority:** P1

---

## Tier 2 — Nice to Have

### 2.1 Gate / Terminal Intelligence
**What:** Show which terminal/gate area the flight departs from, and whether the airline's customer service desk is nearby. Also flag: "This airline boards group 9 last — if you're group 9, you're the most likely volunteer."

**Why it matters:** Actionable intel for the day-of execution. Knowing that Delta's ATL gates are in Concourse B and the rebooking desk is at B3 saves time. Knowing boarding group order helps users position themselves.

**Data source:**
- Airport terminal maps: static data, build once per major hub (FAA airport diagrams are free)
- Airline gate assignments: FR24 schedule API sometimes includes gate info
- Boarding group logic: hardcode per carrier (Delta boards Comfort+ before Main, etc.)

**Effort:** M (mostly static data curation)
**Priority:** P2

---

### 2.2 Historical Bump Outcomes Tracker
**What:** After a user searches and flies, let them log whether they actually got bumped and for how much. Over time, build a crowd-sourced dataset of actual bump outcomes per route/carrier/day.

**Why it matters:** Validates and improves the scoring model with real-world outcomes. "Users who flew DL ATL→LGA on Sundays got bumped 23% of the time" is infinitely more useful than theoretical scores. Also creates a feedback loop for model training.

**Implementation:**
- Simple form: "Did you get bumped? Y/N. Compensation: $___. Delay: ___ hours."
- Store in SQLite
- After N data points, use to calibrate scoring weights

**Effort:** M (UI + storage + eventual model calibration)
**Priority:** P2

---

### 2.3 Fare Class / Booking Strategy Advisor
**What:** Tell users exactly HOW to book for maximum bump probability:
- Book refundable Main Cabin (not Basic Economy — BE passengers are ineligible for VDB on most carriers)
- Don't select a seat (makes you easier to move)
- Check in at exactly T-24h and bid low on the VDB offer
- Book the LAST flight of the day on the route (if that flight cancels, your rebooking goes to tomorrow = 400% compensation)

**Why it matters:** The Playbook page has some of this but it's generic. Per-flight-specific advice ("This is the last ATL→LGA of the day — if bumped, next flight is tomorrow 6:40 AM = guaranteed 400% / $1,550 max") is dramatically more actionable.

**Data source:** FR24 schedule (already have — just identify if this is the last departure on the route for the day)

**Scoring integration:** Add `Last Flight of Day` tag when applicable. These are the jackpot flights.

**Effort:** S (logic over existing schedule data)
**Priority:** P2

---

### 2.4 FAA Ground Delay Program (GDP) Integration
**What:** Pull real-time FAA ATCSCC advisories (Ground Delay Programs, Ground Stops, Airspace Flow Programs) and integrate into scoring. A GDP at EWR is a much stronger signal than METAR weather alone.

**Why it matters:** GDPs are the FAA's official response to demand exceeding capacity. They directly cause the rebooking waves that create VDB opportunities. A GDP is a confirmed disruption, not just weather that *might* cause problems.

**Data source:**
- FAA ATCSCC XML feed: `https://nasstatus.faa.gov/api/airport-status-list` — free, no key, real-time
- Shows: Ground Delay Programs, Ground Stops, closures, and general arrival/departure delays per airport
- Already structured data — trivial to parse

**Scoring integration:** GDP active at origin = +15 pts (severe). GDP at destination = +10 pts. Ground Stop = +20 pts (maximum disruption).

**Effort:** S (simple API integration, similar to weather)
**Priority:** P2 (but could be P1 — very easy to build and very strong signal)

---

### 2.5 Connection-Aware Scoring
**What:** Detect if a scored flight is a common connection point and boost accordingly. If ATL→ORD DL 456 dep 2:30 PM is the standard connection for passengers coming from MIA→ATL DL 123 dep 11 AM, and DL 123 is delayed, then DL 456 gets boosted because those connecting passengers will miss it → some get rebooked onto DL 456 → oversold.

**Why it matters:** Misconnections are a primary driver of oversales. Hub flights that are popular connection targets during disruption windows are the most oversold.

**Data source:**
- FR24 schedule: identify arriving flights at the hub within MCT (minimum connect time) windows before the departure
- BTS T-100: route frequency data to identify high-volume feeder routes
- MCT data: hardcode per airport (ATL = 45 min domestic, ORD = 60 min, etc.)

**Effort:** L (complex logic, but high signal value)
**Priority:** P2

---

### 2.6 Mobile PWA Optimization
**What:** Make BumpHunter a proper Progressive Web App (PWA) optimized for iPhone via Tailscale access. Specific improvements:
- Add `manifest.json` for "Add to Home Screen" with app icon
- Service worker for offline access to cached data and the Playbook
- Bottom tab navigation instead of sidebar (thumb-friendly)
- Swipeable flight cards
- Pull-to-refresh on weather and flight results
- Haptic feedback on score thresholds (iOS Safari supports it)
- Larger touch targets (48px minimum)
- Collapsible factor tags (show top 3, expand for all)

**Why it matters:** User accesses from iPhone via Tailscale. The current desktop sidebar layout is awkward on mobile. PWA install means it feels like a native app and supports push notifications.

**Effort:** M (manifest + service worker + responsive layout adjustments)
**Priority:** P2

---

### 2.7 Score Breakdown Visualization
**What:** Replace the current factor tag list with an interactive radar/bar chart showing how each factor contributes to the total score. Mouse over a bar to see details.

**Why it matters:** Users can't currently see WHY a flight scores high at a glance. A visual breakdown (carrier: 24/30, aircraft: 18/20, weather: 0/15, ...) makes the model transparent and helps users develop intuition for what drives bumps.

**Implementation:** Lightweight — use inline SVG or a tiny chart lib. Each factor rendered as a horizontal bar with max and actual score.

**Effort:** S (UI-only change, data already exists in `factors` array)
**Priority:** P2

---

## Tier 3 — Future / Experimental

### 3.1 ML-Based Score Calibration
**What:** Once we have outcome data (proposal 2.2), train a logistic regression or gradient-boosted model on actual bump outcomes to replace the hand-tuned weights.

**Why:** Hand-tuned weights are good for v1 but real outcomes will reveal which factors actually matter and how much.

**Data needed:** ~500+ logged outcomes with features. Could take months to accumulate.

**Effort:** L
**Priority:** P3

---

### 3.2 Airport-Specific Load Factor from TSA Throughput
**What:** TSA publishes daily checkpoint throughput numbers. Compare today's throughput to historical averages — if ATL is running 12% above average, all ATL flights get a boost.

**Data source:** TSA throughput: `https://www.tsa.gov/travel/passenger-volumes` — published daily, free.

**Effort:** S (scrape daily, compare to running average)
**Priority:** P3

---

### 3.3 Social Media Signal (X/Twitter)
**What:** Monitor Twitter/X for airline delay complaints and cancellation reports. Spike in "#UnitedAirlines delay" or "stuck at ORD" correlates with disruption events.

**Data source:** X API free tier (limited) or scrape trending hashtags.

**Effort:** M (noisy signal, needs NLP filtering)
**Priority:** P3

---

### 3.4 Reverse Search: "When Is My Existing Flight Likely to Be Oversold?"
**What:** User enters their existing booking (flight number + date) and gets a bump probability assessment. "Your DL 323 on Sunday March 8 scores 74/100 — here's why, and here's what to do at the gate."

**Why it matters:** Not all users are booking strategically from scratch. Many already have a ticket and want to know: "Should I volunteer if asked?"

**Effort:** S (just a different UI entry point into existing scoring)
**Priority:** P3

---

## Scoring Model Weight Rebalancing

Based on analysis of the current model vs. what actually drives VDB events, here's a proposed rebalance:

### Current Weights (100 pts total)
| Factor | Current Max | Issues |
|--------|------------|--------|
| Carrier DB Rate | 30 | Reasonable but slightly overweighted vs. route-specific factors |
| Aircraft Size | 20 | Good proxy but seat availability (0.2) would be better |
| Day of Week | 15 | OK, but missing holiday/event signal |
| Time of Day | 10 | Underweighted — last-bank is very strong |
| Weather | 15 | Should include GDP and cascade effects |
| Route Type | 10 | Too simple — needs load factor + connection data |

### Proposed Weights (with new factors, 100 pts total)
| Factor | Proposed Max | Change | Notes |
|--------|-------------|--------|-------|
| Seat Availability | 25 | **NEW** | Strongest real-time signal. If unavailable, fallback to aircraft size (15) |
| Carrier DB Rate | 20 | -10 | Still important but less dominant once we have seat data |
| Weather + GDP + Cascade | 20 | +5 | Combined weather/disruption factor including FAA GDP and cascade logic |
| Holiday / Season / Events | 12 | **NEW** | Replaces part of day-of-week |
| Day of Week + Time of Day | 10 | Combined | Merge these — both are demand timing signals |
| Route Dynamics | 8 | -2 | Hub/slot/fortress + route reliability |
| Aircraft Size | 5 | -15 | Demote once seat availability is available (keep as fallback) |

---

## Implementation Priority Roadmap

### Sprint 1 (This Weekend)
1. **0.1** Holiday/Event Calendar — S effort, P0, instant scoring improvement
2. **2.3** Last-Flight-of-Day Detection — S effort, embedded in 0.1 sprint
3. **2.4** FAA GDP Integration — S effort, massive signal-to-effort ratio
4. **2.7** Score Breakdown Visualization — S effort, improves UX immediately

### Sprint 2 (Next Week)
5. **0.3** BTS On-Time Performance — M effort, strong signal
6. **1.1** Cascade Analysis — M effort, builds on existing weather
7. **1.3** Best Day Heatmap — M effort, killer UX feature
8. **1.5** Compensation Calculator — M effort, makes $$$ concrete

### Sprint 3 (Week After)
9. **1.4** Multi-City Search — M effort, power user unlock
10. **1.2** Push Alerts — M effort, engagement + time-sensitive opportunities
11. **2.6** PWA Mobile Optimization — M effort, daily-driver quality

### Sprint 4+ (When Feasible)
12. **0.2** Seat Availability Scraping — L effort, game-changer but hard
13. **1.6** Operating Carrier Lookup — M effort, scoring accuracy
14. **2.5** Connection-Aware Scoring — L effort, advanced
15. **2.2** Outcome Tracker — M effort, long-term model improvement

---

## Summary: What Moves the Needle Most

The single biggest gaps in the current product, ordered by impact:

1. **Seat availability data** (0.2) — transforms from proxy-based guessing to knowing which flights are actually full. Hard to build but game-changing.
2. **Holiday/event awareness** (0.1) — trivial to add, eliminates the biggest blind spot in current scoring.
3. **FAA GDP data** (2.4) — trivial to add, replaces weather-guessing with confirmed disruption data.
4. **Cascade analysis** (1.1) — the real money is in post-disruption flights, not during-disruption flights.
5. **Multi-city search** (1.4) — unlocks the core power-user workflow: "where should I fly to get bumped?"
6. **Compensation calculator** (1.5) — makes the dollar value concrete per flight, not a vague "~$600."
