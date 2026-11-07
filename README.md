# Harvest Village

A cozy farming browser game with a real backend: buy seeds, plant, wait, harvest and sell. Accounts, farms and
progress live in SQLite and the server is the single authority for coins, inventory, crop growth and rewards.

This is the **standalone game only**. It deliberately contains no clan, chat, invitation or community features and
no SDK code. See [Future SDK integration](#future-sdk-integration).

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

Optional: `cp .env.example .env` to change ports or settings. Every value has a working default and there are no secrets to configure.

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
npm test         # backend (28 tests) + frontend (4 tests)
npm run e2e      # ~20 s: starts a real server, plays the full loop, restarts it, checks races + persistence
```

## Architecture

```
backend/src/
  app.ts            wires modules together (the only place auth and game meet)
  auth/             passwords (scrypt), sessions, requireAuth, /api/auth routes. Knows nothing about the game.
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

## Future SDK integration

- Auth and game are separate modules joined only in `app.ts`; the game takes a verified `userId` and nothing else.
- **The game's session cookie is not, and must not be treated as, an SDK player token.** That exchange (the architecture doc's `POST /players/auth` flow, where the game's *server* trades an API key for a short-lived token) is intentionally left for a separate task. `auth/` is where a future "issue SDK token for the logged-in player" endpoint would sit.
- `frontend/src/App.jsx` renders an empty `#community-overlay-root` (fixed, bottom-right) and the layout keeps `--community-reserve` of space free at the bottom (`styles.css`). Nothing renders there today: no buttons, no placeholders.

## Limitations

- Single-process design: the rate limiter is in memory and SQLite allows one writer at a time. Fine for a demo and small games; use Postgres + shared rate limiting to scale out.
- No email, password reset or "change password"; username/password only.
- Crops yield 1 item per harvest and the farm size and unlock levels are fixed in code.
- The server never auto-advances anything, so "offline growth" is just timestamps passing; there is no notification when crops ripen.
- No Docker files (optional per the brief). `node:sqlite` is still flagged experimental by Node, though stable in practice for this use.
- Cross-process race safety relies on SQLite's `BEGIN IMMEDIATE` plus conditional updates; parallel-request tests run against one Node process, not several.
