## Session 11 — Hubcap Provider Status and API Usage Card in Settings (Step 38)

### Goal
Add a compact Hubcap provider status/usage card in Settings near the Hubcap API key input.

### Part 1: Hubcap API service (`src/services/hubcapApiService.ts`)
- `checkHubcapHealth(baseUrl)` — GET `/api/v1/health`, no auth, returns online/offline/degraded/error + elapsed ms
- `fetchHubcapUserStats(baseUrl, apiKey)` — GET `/api/v1/user/stats` with Bearer auth, normalizes flexible response shape to `HubcapUsageStats`
- `fetchHubcapDepotKeys(baseUrl, apiKey)` — GET `/api/v1/depot-keys` with Bearer auth, returns count + ok/unauthorized/forbidden/error status
- `clearHubcapCaches()` — clears all caches for manual refresh
- 5-min TTL cache per endpoint; shorter 60s error cache
- `[HUBCAP][HEALTH]`, `[HUBCAP][USAGE_REFRESH]`, `[HUBCAP][AUTH]`, `[HUBCAP][RATE_LIMIT]`, `[HUBCAP][DEPOT_KEYS]` diagnostic logs
- No API key logged. No calls during render. No polling.

### Part 2: HubcapStatusCard component (`src/components/settings/HubcapStatusCard.tsx`)
- Card follows existing `lf-surface rounded-2xl border p-5` styling (matching `ProviderSettingsCard`)
- Header: Activity icon + "Hubcap Provider" title + status badges
- `StatusBadge` component with color-coded variants (green=online/valid, red=offline/error/invalid/forbidden, amber=degraded/ratelimited, muted=unknown)
- `StatRow` component showing label + current/max + "daily" suffix
- `UsageBar` component: thin progress bar with color shift at 70%/90% thresholds
- `formatCountdown` helper: converts `resetInSeconds` or `resetAt` to "in 12h 32m" format
- `formatResetTime` helper: shows absolute reset time

### Part 3: Settings page integration
- `HubcapStatusCard` rendered below the provider grid in the "providers" tab
- Reads hubcapdb API key and baseUrl from `settings.providers.hubcapdb` via `useSettings()`
- Auto-checks health on mount (no auth needed, cache-backed)
- Manual "Test Connection" button triggers health check + clears caches
- Manual "Refresh Usage" button triggers `fetchHubcapUserStats` + `fetchHubcapDepotKeys` in parallel
- "Hubcap Docs" link opens `https://hubcapmanifest.com` in new tab
- 30s countdown ticker updates reset display
- Auth error hints: "API key is invalid" (401), "API key is valid but lacks permission" (403), "Daily usage limit reached" (429)

### Part 4: Improved Hubcap download error messages
- `Store.tsx` and `PackageCard.tsx` now show: `"HubcapDB rechazó la descarga. Revisa la API key en Configuración > Providers. (HTTP 401)"`
- Non-Hubcap providers show generic auth error

### Key Files Changed
- `src/services/hubcapApiService.ts` — **new** — health, stats, depot keys + caching
- `src/components/settings/HubcapStatusCard.tsx` — **new** — status/usage card component
- `src/pages/Settings.tsx` — imported and placed HubcapStatusCard in providers section
- `src/pages/Store.tsx` — improved Hubcap-specific auth error message
- `src/components/packages/PackageCard.tsx` — improved Hubcap-specific auth error message
