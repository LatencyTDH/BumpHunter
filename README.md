<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />

# BumpHunter

**Find overbooked flights. Get paid to give up your seat.**

A flight overbooking strategy app that identifies voluntary denied boarding (VDB) compensation opportunities using real-time flight data, live weather, DOT statistics, and historical airline patterns.

[![Live Weather](https://img.shields.io/badge/data-aviationweather.gov-blue)](https://aviationweather.gov)
[![BTS Data](https://img.shields.io/badge/data-DOT%20BTS-green)](https://www.transportation.gov/individuals/aviation-consumer-protection/bumping-oversales)
[![FR24 Data](https://img.shields.io/badge/data-FlightRadar24-orange)](https://www.flightradar24.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb)](https://react.dev/)

</div>

---

## What Is This?

Airlines routinely oversell flights — they book more passengers than seats, betting some won't show up. When everyone shows up, they need **volunteers** to take a later flight in exchange for compensation (often $500–$1,500+ in travel vouchers or cash).

**BumpHunter** turns this into a strategy game. It analyzes real data to predict which flights are most likely to be oversold, so you can book those flights intentionally and volunteer to get bumped — pocketing the compensation.

## Features

### 🎯 Command Center
Real-time dashboard showing live weather disruptions across major US hubs (ATL, DFW, EWR, ORD, DEN, LAS, LGA, JFK, MCO, CLT). Weather data pulled directly from **aviationweather.gov** METAR reports — thunderstorms, low visibility, and high winds all create cascading delays that lead to oversold flights.

### ✈️ Flight Scanner
Search any route and date to find **real flights** ranked by **bump probability**. Flight data comes from FlightRadar24 (live flights in the air) and OpenSky Network (recent departures), with routes verified via ADSBDB. Each result includes:
- Airline, aircraft type, capacity, departure time
- Bump probability score with detailed factor breakdown
- Verification badge (FR24 live data or ADSBDB route verification)
- Direct link to FlightAware for authoritative flight tracking

**No fake data. Ever.** If real-time data is unavailable (rate limits, etc.), BumpHunter shows an honest message instead of fabricated flights.

### 📊 Historical Analysis
Real denied boarding statistics from the **DOT Bureau of Transportation Statistics**:
- **By Carrier** — VDB rates, IDB rates, load factors, and average compensation for every major US airline
- **Quarterly Trends** — How denied boardings track across seasons (summer peaks, holiday surges)
- **Top Oversold Routes** — The specific city pairs with the highest oversale rates

Data notes are displayed inline — compensation figures marked with `~` use DOT-published industry averages where BTS fields report $0 (BTS tracks IDB cash only, not VDB vouchers). Latest available data: Q3 2021.

### 📖 The Playbook
Step-by-step execution guide covering the full bump-hunting lifecycle: strategic booking, check-in bidding, gate agent approach, and compensation negotiation tactics.

## Scoring Algorithm

Each flight receives a **bump probability score (0-98%)** based on 8 weighted factors:

| Factor | Max Points | Data Source |
|--------|-----------|-------------|
| Carrier denied boarding rate | 15 | DOT BTS Consumer Report |
| Route load factor | 20 | BTS T-100 Domestic Segment |
| Day of week pattern | 15 | Historical analysis |
| Time of day (bank position) | 15 | Departure time analysis |
| Aircraft type & capacity | 20 | FR24 aircraft data / Fleet estimation |
| Weather disruptions | 25 | aviationweather.gov METAR |
| Season / holiday period | 10 | Calendar |
| Fortress hub dynamics | 5 | Hub concentration analysis |

**Base score: 25** → factors are additive → **capped at 98%**

### What Makes a Flight Score High?

- **Regional jets** (CRJ-900, E175) with only 76 seats oversell easily → +20 pts
- **Last-bank departures** (after 6 PM) catch all the day's misconnections → +15 pts
- **Thunderstorms at origin** cause ground stops and rebooking waves → +25 pts
- **Monday/Thursday/Friday** are peak business travel days → +15 pts
- **Delta at ATL**, **American at DFW/CLT**, **United at EWR/ORD/DEN** — fortress hubs with less competition → +5 pts

## Data Sources

All data is **free** — no paid API keys required:

| Source | What It Provides | Cost |
|--------|-----------------|------|
| [FlightRadar24](https://www.flightradar24.com) | Real-time flights currently in the air with origin/destination | Free public feed |
| [OpenSky Network](https://opensky-network.org) | Recent departure data with callsigns | Free (rate limited) |
| [ADSBDB](https://www.adsbdb.com) | Route verification — confirms callsign origin/destination | Free, no key |
| [aviationweather.gov](https://aviationweather.gov) | Real-time METAR weather reports for all US airports | Free, no key |
| [DOT BTS](https://www.bts.gov) | Denied boarding rates, load factors, oversale statistics | Free (bundled CSV) |
| [FlightAware](https://www.flightaware.com) | Authoritative flight tracking (linked per flight) | Free (external link) |

The backend caches data aggressively — FR24 feed for 5 min, OpenSky departures for 1 hour, ADSBDB routes for 24 hours, weather for 15 min — using SQLite for the cache layer.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Tailwind CSS 4, Framer Motion, Lucide icons |
| Backend | Express 4, Node.js, TypeScript (tsx) |
| Database | better-sqlite3 (cache layer) |
| Data | FR24 feed, OpenSky Network, ADSBDB, aviationweather.gov, bundled DOT BTS CSVs |
| Build | Vite 6, concurrently |

## Getting Started

### Prerequisites

- **Node.js** 18+ (tested with 22 and 25)
- npm

### Install & Run

```bash
git clone https://github.com/LatencyTDH/BumpHunter.git
cd BumpHunter
npm install
npm run dev
```

This starts both the API server (port 3001) and Vite dev server (port 3000). Open **http://localhost:3000**.

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start both API + frontend (recommended) |
| `npm run dev:server` | Start only the Express API server |
| `npm run dev:client` | Start only the Vite frontend |
| `npm run build` | Production build |
| `npm run lint` | TypeScript type check |

### Optional: Gemini AI

If you want AI-powered analysis, add your Gemini API key:

```bash
cp .env.example .env.local
# Edit .env.local and set GEMINI_API_KEY
```

## API Endpoints

The Express backend exposes these endpoints (proxied through Vite in dev):

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Health check |
| `GET /api/weather/alerts?hubs=ATL,EWR` | Live weather disruptions from METAR data |
| `GET /api/weather/metar?airports=ATL` | Raw METAR observations |
| `GET /api/flights/search?origin=ATL&dest=LGA&date=2026-03-01` | Flight search with bump scoring (real flights only) |
| `GET /api/stats/carriers` | Carrier denied boarding statistics |
| `GET /api/stats/trends` | Quarterly denied boarding trends |
| `GET /api/stats/routes` | Top oversold routes |
| `GET /api/stats/summary` | Dashboard summary data |

## Project Structure

```
bumphunter/
├── server/
│   ├── index.ts        # Express API server & routes
│   ├── data.ts         # BTS statistics, aircraft DB (NO schedule templates)
│   ├── fr24.ts         # FlightRadar24 public feed client
│   ├── opensky.ts      # OpenSky + ADSBDB + FR24 unified flight fetcher
│   ├── scoring.ts      # Bump probability scoring algorithm
│   ├── weather.ts      # aviationweather.gov METAR service
│   └── cache.ts        # SQLite cache layer
├── src/
│   ├── App.tsx         # React app with all UI components
│   ├── api.ts          # Frontend API client with retry logic
│   ├── main.tsx        # React entry point
│   └── index.css       # Tailwind CSS imports
├── data/
│   ├── bts_involuntary_denied_boarding.csv
│   └── bts_t100_airports_2024.csv
├── index.html
├── vite.config.ts
├── package.json
└── tsconfig.json
```

## Legal Note

Voluntary denied boarding (VDB) is a completely legal and airline-sanctioned practice. Airlines are required by DOT regulations to ask for volunteers before involuntarily denying boarding. BumpHunter simply helps you identify when volunteering is most likely to be needed — and most likely to be lucrative.

## License

MIT
