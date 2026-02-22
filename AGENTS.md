# AGENTS.md — Coding Agent Guide

Read `README.md` first for project overview, features, data sources, and setup.
This file covers what agents need beyond that: rules, conventions, and gotchas.

## Hard Rules

1. **No fake data. Ever.** If a data source is unavailable, show "data unavailable." No fallback templates, no placeholder flight numbers, no fabricated schedules.
2. **Operating carrier for scoring.** AA 4533 operated by Republic → score at Republic's 9.70/10k rate, not American's 3.46/10k. See `getOperatingCarrierStats()` in `server/data.ts`.
3. **Bump Score ≠ probability.** It's a 0–100 relative index. Never present it as a percentage chance.
4. **Don't cache empty results.** Only cache responses with actual data. Caching failures/empty results locks users into "unavailable" state for the cache TTL. (This was a real bug.)
5. **All tests pass before merge.** `npm test` — currently 92 tests, 12 files.
6. **Type-check clean.** `npm run lint` (tsc --noEmit). Zero errors.
7. **Rebase on main before opening PRs.**

## Conventions

- **Remotes:** `origin` = LatencyTDH/BumpHunter (upstream), `fork` = seans-openclawbot/BumpHunter (PR source)
- **Branches:** `main` (stable/prod), `feat/*` (features), `fix/*` (bugs)
- **Path alias:** `@/*` maps to project root in both `tsconfig.json` and `vitest.config.ts`
- **Import style:** Use `.js` extensions in server imports (bundler-style resolution). Vitest has a custom plugin in `vitest.config.ts` that resolves `.js` → `.ts` — don't remove it.
- **Production deploy:** `npm run build && systemctl --user restart bumphunter` (manual, no auto-deploy)

## Scoring Model (current, 8 factors)

The README has a summary, but here are the exact weights from `server/scoring.ts`:

| # | Factor             | Max Pts | Key detail                                          |
|---|--------------------|---------|-----------------------------------------------------|
| 1 | Carrier VDB rate   | 22      | OPERATING carrier from 2025 ATCR data               |
| 2 | Aircraft size      | 15      | Smaller planes → tighter margins                    |
| 3 | Cascade boost      | 13      | Bad weather at upstream hub → rebooking waves        |
| 4 | Weather            | 11      | Live METAR (thunderstorms, low vis, wind)            |
| 5 | Timing & demand    | 10      | Day of week + holiday/event calendar                 |
| 6 | Route type         | 10      | Hub, slot-controlled, fortress hub dynamics          |
| 7 | Route reliability  | 8       | BTS on-time delay rate for the city pair             |
| 8 | Time of day        | 7       | Peak departure windows, last-bank flights            |

Total max: 96 pts, displayed 0–100.

## Gotchas

- **FR24 429s in tests** — the test suite hits real FR24 endpoints. Tests handle this gracefully via fallback paths. Don't mock FR24 unless testing something unrelated to data fetching.
- **FR24 Schedule API rejects dates >3 days out** (HTTP 400). `server/fr24.ts` handles this by retrying with today's schedule as a proxy. Flag the data source clearly if you touch this logic.
- **OpenSky rate limits** — ~100 req/day free tier, 24h cooldown on 429. It's tertiary; don't depend on it for core paths.
- **`.cache.db` is SQLite** — stale data? `rm .cache.db` and restart.
- **Vite dev server** needs `allowedHosts` configured for Tailscale hostname access (`vite.config.ts`).
- **`server/prod.ts`** serves the Vite build + API together. `server/index.ts` is dev-only (API-only, Vite handles frontend separately).
