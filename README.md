# Harvest Village

A cozy farming browser game with a real backend: buy seeds, plant, wait, harvest and sell. Accounts, farms and
progress live in SQLite and the server is the single authority for coins, inventory, crop growth and rewards.

The farming game retains its own login and database. An optional Clan player-token bridge and SDK Discover
panel are included. See [Clan Platform integration](#clan-platform-integration).

| Part | Tech |
| --- | --- |
| Frontend | React + Vite (plain JavaScript), plain CSS, hand-drawn SVG icons |
| Backend | Express 5 + TypeScript, `zod` validation, `helmet` |
| Database | SQLite via Node's built-in `node:sqlite` (no native modules to compile), SQL migrations applied on startup |
| Tests | Vitest + Supertest (backend), Vitest (frontend), end-to-end script against a real server |

## Run it (one command)

Requires **Node.js 22.13 or newer** (LTS 22 or 24). There are no native modules, so `npm install` needs no compiler or build tools. Node 22 may print an "ExperimentalWarning: SQLite" line on startup; it is harmless.

```bash
npm install
npm run dev
```

Open **http://localhost:5173**. That starts the API (port 3001) and the Vite dev server (port 5173, proxies `/api`).
The database file is created automatically at `backend/data/harvest.db` and migrations run on startup.

Optional: `cp .env.example .env` to change ports or settings. Farming needs no secrets. Clan authentication optionally needs a server-only API key.

### Windows PowerShell

```powershell
# 1. Install Node.js 22.13+ (LTS) from https://nodejs.org if `node -v` is older or fails
Expand-Archive .\harvest-village.zip -DestinationPath .
cd .\harvest-village
npm install
npm run dev
```

Open http://localhost:5173. Optional: `Copy-Item .env.example .env`. Production-style run: `npm run build` then `npm start`.
If PowerShell blocks `npm` scripts ("running scripts is disabled"), run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, or use `npm.cmd` instead of `npm`.

### Two demo players for a presentation

On the login screen (dev mode only) click **Create demo accounts**, then **Log in as demo_alice**. Open a second
**private/incognito window** (cookies are shared within one browser profile) and log in as **demo_bob**.
Or from a terminal: `npm run seed:demo` (add `-- --reset` to recreate both with fresh farms).

| Username | Password |
| --- | --- |
| `demo_alice` | `alice-demo-pass` |
| `demo_bob` | `bob-demo-pass` |

These are public throwaway credentials. The route and buttons exist only when `NODE_ENV` is not `production`; the CLI refuses to run in production.

### Production-style run (single process, same origin)

```bash
npm run build
npm start          # serves the API and the built frontend on http://localhost:3001
```

In production the session cookie is named `__Host-hv_session` and is `HttpOnly; Secure; SameSite=Lax; Path=/`. Run it behind HTTPS
(set `TRUST_PROXY=true` behind a reverse proxy). To try the production build over plain http on your own machine, set `COOKIE_SECURE=false`.

## How to play

1. You start with 50 coins and 3 carrot seeds. A short tutorial shows on first login (**Help** reopens it).
2. Pick a seed above the farm, tap an empty plot to plant it.
3. Plots go **Empty → Planted → Growing → Ready!** with a countdown. Tap a glowing plot to harvest.
4. Sell crops in the **Barn**; buy more seeds in the **Seed Shop**. Harvests earn XP. Level 2 unlocks pumpkins.

| Crop | Seed | Grows | Sells | XP | Unlock |
| --- | --- | --- | --- | --- | --- |
| Carrot | 10 | 15 s | 18 | 8 | level 1 |
| Tomato | 25 | 30 s | 55 | 20 | level 1 |
| Pumpkin | 60 | 60 s | 140 | 50 | level 2 |

Level N needs `25·N·(N-1)` total XP (L2 = 50, L3 = 150, L4 = 300). The farm is a 3×3 grid. All numbers live in `backend/src/game/catalog.ts`.

## Tests

```bash
npm test         # backend (52 tests) + frontend (14 tests)
npm run e2e      # ~20 s: starts a real server, plays the full loop, restarts it, checks races + persistence
```

## Architecture

```
backend/src/
  app.ts            wires modules together (the only place auth and game meet)
  auth/             passwords (scrypt), sessions, requireAuth, /api/auth routes. Knows nothing about the game.
  clan/             optional authenticated player-token bridge to Platform; no farming logic
  game/             catalog (rules), service (authoritative logic + transactions), /api/game routes
  db/               connection, migration runner, migrations/*.sql
  dev/              demo accounts (development only)
  http/             error format, rate limiter
frontend/src/
  api.js            fetch client (cookies are automatic; no tokens in JS)
  game/             useGame hook + pure plot-state helpers
  components/       AuthScreen, Header (profile), Farm, Shop, Barn, Tutorial, Toasts, GameScreen
```

### API

All JSON under `/api`. Errors always look like `{ "error": { "code": "not_ready", "message": "…", "details"?: … } }`.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/auth/register`, `/auth/login` | Create account / log in (sets the session cookie) |
| POST | `/auth/logout` | Destroys the session server-side and clears the cookie |
| POST | `/clan/token` | Requires the existing game session; returns only `{ token }` from Clan Platform |
| GET | `/auth/me` | Current player (id, username) |
| GET | `/game/state` | Profile, plots with timestamps, inventory, crop catalog, server time |
| POST | `/game/shop/buy` `{cropId, quantity}` | Buy seeds |
| POST | `/game/plots/:index/plant` `{cropId}` | Plant a seed |
| POST | `/game/plots/:index/harvest` | Harvest a ripe crop |
| POST | `/game/sell` `{cropId, quantity \| "all"}` | Sell harvested crops |
| GET | `/config`, `/health` | Dev-mode flag, liveness |
| POST | `/dev/demo-accounts` | Dev only: create/reset demo accounts |

Error codes: `unauthorized`, `invalid_credentials`, `username_taken`, `validation_error`, `unknown_crop`, `plot_not_found`,
`insufficient_coins`, `insufficient_seeds`, `insufficient_crops`, `plot_occupied`, `plot_empty`, `not_ready`, `level_too_low`,
`forbidden_origin`, `rate_limited`.

### Security and authority

- **Passwords**: scrypt with a random salt per user; only the hash is stored and it is never returned.
- **Sessions**: a random 256-bit token in an `HttpOnly` cookie; only its SHA-256 is stored. Logout deletes the row, so a replayed cookie fails. Default lifetime 7 days.
- **Identity** comes only from the session (`req.auth`). No endpoint accepts a user id, and tests try to spoof one via body, query and header.
- **CSRF**: `SameSite=Lax` plus an `Origin` allow-list on every state-changing request.
- **Brute force**: login/register are rate limited (in memory, per IP+username). Unknown usernames cost the same CPU as wrong passwords, with identical error messages.
- **Authoritative timers**: planting stores `planted_at` and `ready_at` from the server clock. Harvest eligibility is checked in the database transaction. The browser only draws progress from those timestamps (adjusted by the server's clock) and re-syncs when a crop should be ripe.
- **No duplicate rewards or spending**: every action runs in `BEGIN IMMEDIATE`, and each change is a conditional `UPDATE` that re-checks its precondition (`coins >= cost`, `quantity >= n`, `crop_id IS NOT NULL AND ready_at <= now`). A failed check throws and rolls the whole action back. `CHECK` constraints stop negative coins/inventory at the database level.
- **Headers**: `helmet` (CSP, nosniff, …); API responses are `no-store`. The frontend renders text through React (no `innerHTML`).

## Clan Platform integration

For the ordered request flow, file responsibilities, and a checklist for adding a second widget, see
[Clan widget flow and adding another widget](docs/clan-widget-flow.md).

Keep using the existing game registration/login. After login, the browser can call `POST /api/clan/token`
with the game session cookie and an empty body (or `{}`). The game server obtains a player token from
Platform and returns **only `{ "token": "..." }`**. The game session cookie is not a Clan player token.

Set these optional variables in the repository-root `.env` or the game server's environment:

```dotenv
CLAN_PLATFORM_URL=http://localhost:8081
CLAN_GAME_API_KEY=replace-with-the-key-issued-for-your-game
```

`CLAN_PLATFORM_URL` is an HTTP(S) service base URL, without the player-auth path, query, fragment or credentials.
An optional reverse-proxy path prefix is preserved. Use HTTPS outside local development.
`CLAN_GAME_API_KEY` is a secret, used only by the backend. Neither setting is returned by `/api/config`;
never put them in `VITE_*` variables, browser code, URLs, logs or source control. `.env` is ignored.
The game does not create a key or run Platform for you.

Confirmed against the local `clan-backend` checkout on 2026-11-08:
`services/platform/internal/handler/players.go`, `handler.go`, `players_test.go`, and
`services/platform/internal/service/players.go` (checkout HEAD `6d05bceb165a0b32d7c8e45f0900b9032ed5f39c`).
This is source-contract verification, not a live-service or latest-remote verification.

| Platform contract | Value |
| --- | --- |
| Request | `POST /api/v1/players/auth`, JSON content type |
| Authentication | `X-API-Key: <server-only game key>` |
| Body | `{ "externalPlayerId": "<users.id>", "displayName": "<users.username>" }` |
| Success | HTTP 200, `{ "token": "...", "expiresIn": 3600 }` (seconds) |
| Game identity | Derived by Platform from the API key, never supplied by the browser |

The bridge uses `req.auth.userId` (the stable database ID, unchanged across login sessions) and
`req.auth.username` from the existing session middleware. Request bodies, query parameters and client headers
cannot override player identity, display name, API key or game. Only `token` is forwarded from a valid response;
`expiresIn` and extra upstream fields are discarded. Responses use `Cache-Control: no-store`.

The frontend exports `getClanPlayerToken()` from `frontend/src/api.js`. It calls the game endpoint with
`credentials: 'same-origin'` and returns the token string. Call it on demand or later supply it as an SDK
callback; it is not automatically called on render and does not persist/log tokens.

After login, click **Open clans**. The game initializes the SDK with public `VITE_GAME_ID`,
`VITE_PLATFORM_URL`, and `VITE_SOCIAL_URL`, plus the existing `getClanPlayerToken` callback. It mounts with
`sdk.mountExperience({ container })` and handles `widget.ready`; the SDK owns published-config fetching,
caching, fallback, default response adapters, and navigation. Closing/logout/account changes destroy the widget,
and stale readiness results cannot update a newer instance. No game-owned Social bootstrap/screens are added.

Set these public values in the root `.env` and publish that game's configuration in Platform:

```dotenv
VITE_GAME_ID=<the-game-id-associated-with-CLAN_GAME_API_KEY>
VITE_PLATFORM_URL=http://localhost:8081
VITE_SOCIAL_URL=http://localhost:8082
```

The SDK used by this game must implement the Platform loader and `widget.ready`. Set tooling-only
`CLAN_SDK_ENTRY` to its `src/index.js` when using a separate checkout. The older nested SDK copy lacks that API;
this workspace now resolves the newer Desktop checkout without editing either SDK. Restart Vite after changing
`.env` or the SDK path, and rebuild production assets. The game no longer imports its old local JSON and makes
no `/__dev__/chat-config` request. The edited JSON file is preserved as an unused reference.

No developer token or secret API key belongs in a `VITE_*` variable. The game API key stays backend-only.
Platform and Social CORS must allow the game's origin. The unchanged backend still reads
`VITE_CLAN_SOCIAL_URL` for Social CSP: keep it equal to `VITE_SOCIAL_URL`. For production, configure a deployment
reverse proxy/CSP that permits both public services; the existing backend CSP does not allow a separate Platform
origin. No backend change is included here. See [published-widget setup](docs/published-widget-setup.md).

Failure behavior:

| Condition | Game response |
| --- | --- |
| Missing/expired game session | 401 `unauthorized` |
| Missing or invalid Clan settings | 503 `clan_not_configured` |
| Platform HTTP failure, network failure, redirect, or malformed token response | 502 `clan_upstream_error` |
| Five-second deadline exceeded (including response-body loading) | 504 `clan_upstream_timeout` |

Upstream details/headers are not forwarded or logged. In particular, a rejected API key does not become a game
login 401. No automatic retries or redirect following occur. Missing Clan configuration does not prevent server
startup, login, or farming.

`backend/tests/clan.test.ts` uses mocked Platform fetch responses, real game sessions and SQLite to check
identity isolation, overrides, failures/timeouts, and secret filtering. `frontend/src/api.test.js` checks the helper.
`frontend/src/community/discover.test.js` exercises SDK list/search/join with the game token callback using
mock HTTP responses. These mocks do not verify Platform JWT signing, key validity, or deployed connectivity. To verify live, configure
your Platform URL/key, log into the game, and explicitly call the helper; never print/store its returned token.

## Limitations

- Single-process design: the rate limiter is in memory and SQLite allows one writer at a time. Fine for a demo and small games; use Postgres + shared rate limiting to scale out.
- No email, password reset or "change password"; username/password only.
- Crops yield 1 item per harvest and the farm size and unlock levels are fixed in code.
- The server never auto-advances anything, so "offline growth" is just timestamps passing; there is no notification when crops ripen.
- No Docker files (optional per the brief). `node:sqlite` is still flagged experimental by Node, though stable in practice for this use.
- Cross-process race safety relies on SQLite's `BEGIN IMMEDIATE` plus conditional updates; parallel-request tests run against one Node process, not several.
