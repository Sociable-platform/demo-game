# Harvest Village

A cozy farming browser game with a real backend: buy seeds, plant, wait, harvest and sell. Accounts, farms and
progress live in SQLite and the server is the single authority for coins, inventory, crop growth and rewards.

The farming game retains its own login and database. An optional backend-only Clan player-token bridge
is included. See [Clan Platform integration](#clan-platform-integration).

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

## Account deletion

Open the avatar/username menu, choose **Account settings**, then **Delete my account…**. The confirmation
explains that the game account, all farm progress and the Social profile are
permanently deleted. Cancel closes it; while deletion is running the controls are
disabled. A failure keeps the account and shows a retryable error. Success returns
to login and destroys the mounted community widget and in-memory game state.

Configure these **backend-only runtime settings** (never `VITE_` variables):

```dotenv
CLAN_PLATFORM_URL=http://localhost:8081
CLAN_SOCIAL_URL=http://localhost:8082
CLAN_GAME_API_KEY=your-game-server-key
```

In Docker, the existing Compose defaults use `host.docker.internal:8081` and
`:8082`. Helm exposes `clanPlatformUrl` and `clanSocialUrl`; set both to addresses
reachable by the game server. The API key remains in the existing runtime Secret.

`DELETE /api/auth/account` derives identity only from the authenticated session.
It obtains a fresh Platform player token using the same helper/request format as
`POST /api/community/token` (the existing `/api/clan/token` alias is preserved),
then calls Social `DELETE /api/v1/players/me`. Only 204 or 401 with
`error.code = player_deleted` permits local deletion. The cleanup token never
reaches the browser. Both upstream calls have a five-second deadline, including
response bodies; redirects are rejected. Errors/logs contain no credentials or
upstream response bodies.

If either service fails, local account data and sessions remain intact. Missing
configuration returns 503; upstream failures/timeouts return 502; a local deletion
failure returns 500 and leaves the account available for a retry. Retrying always
gets a fresh token and safely handles an already-deleted Social profile. The local
transaction uses foreign-key cascades to delete sessions, player stats, farm plots
and inventory. Concurrent requests for one user share one cleanup operation, and
the token bridge refuses to issue widget tokens while that deletion is pending.

Demo resets (HTTP and `seed:demo -- --reset`) use this same cleanup service. They
stop on cleanup failure, keeping the failed account and any unprocessed accounts;
earlier successfully reset demo accounts may already have been recreated. There
is no separate local-only bulk deletion path. Creating demo accounts when absent
does not require Social connectivity.

Validation: backend deletion tests mock Platform/Social `fetch` with real SQLite
and game sessions. The browser deletion check runs the built game and backend
with in-memory SQLite, mocked Platform/Social responses and a mocked widget to
verify confirmation/cancel/pending/error/success and widget cleanup. A separate TEAM-249
integration check must use real services: delete `test` via the game UI, verify
another player's search no longer finds it, then register `test` again, open the
community widget and verify search finds exactly the new profile.

## Tests

```bash
npm test         # backend (52 tests) + frontend (14 tests)
npm run e2e      # ~20 s: starts a real server, plays the full loop, restarts it, checks races + persistence
# After building a Docker image (see below):
IMAGE_CHECK_IMAGE=harvest-village:local IMAGE_CHECK_PORT=13001 npm run test:image
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

### Unique usernames

Registration and login trim surrounding whitespace and compare usernames without
case sensitivity. `Nuray`, `nuray` and ` nuray ` refer to the same name. The stored
display name keeps the player's chosen capitalization (`NuRaY` stays `NuRaY`).
Allowed name characters remain ASCII letters, digits and underscores, 3–20
characters after trimming. Leading/trailing Unicode whitespace is trimmed too.

Duplicate registration returns HTTP **409**, code `username_taken`, and the form
shows **“This username is already taken.”** A backend check provides early
feedback; SQLite's `idx_users_username_normalized` unique expression index is
the final guard for concurrent registrations and direct database writes.

Migration `002_unique_normalized_usernames.sql` runs automatically on startup,
including for existing Docker volumes after rebuilding the image. It adds the
index and trims legacy display names without changing their capitalization,
account IDs, password hashes, sessions or farm data.

#### Existing username conflicts

If legacy names collide under the new rules, migration stops and rolls back.
`UsernameConflictError` reports the normalized name plus every affected account's
ID and current username. No account is automatically renamed, merged or deleted.
Choose which account retains the name and give the others unused valid names.
Back up the database first, then update **only `users.username` by account ID**:

```sql
BEGIN IMMEDIATE;
UPDATE users SET username = 'Nuray_2' WHERE id = '<reported-account-id>';
COMMIT;
```

Run this with a SQLite client against the affected database while the game is
stopped. For Docker, Node's built-in SQLite can make that same targeted update:

```sh
docker compose stop game
docker compose run --rm --no-deps game node --input-type=module -e "import {DatabaseSync} from 'node:sqlite'; const db=new DatabaseSync('/app/data/harvest.db'); db.prepare('UPDATE users SET username=? WHERE id=?').run('Nuray_2','<reported-account-id>'); db.close();"
docker compose up -d game
```

Replace both placeholders with the administrator-selected name and reported ID.
The unchanged ID preserves all progress and relationships. Restart to retry the
migration. Host-run games use `backend/data/harvest.db` unless `DB_PATH` overrides
it; Docker uses `/app/data/harvest.db` in **`harvest-village-data`**. These are
separate databases and must each be migrated. Migration regression tests cover
conflict reporting, rollback, a targeted rename, existing-account login and
preservation of farm progress.

## Clan Platform integration

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

### Script-tag SDK panel

The HTML loads `<script src="%VITE_CLAN_SDK_URL%"></script>` before the game module.
Vite replaces the URL during development and production builds. Opening **Open clans** reads
`window.ClanSDK`, calls `init()` with the public settings and the existing game player-token
callback, and mounts `mountExperience()`. Closing the panel, logging out, or changing accounts
destroys that instance. A missing script or failed mount displays a panel error while farming
continues. There is no npm SDK dependency or local checkout requirement.

Set these public values in the game-root `.env`:

```dotenv
VITE_GAME_ID=your-platform-game-id
VITE_PLATFORM_URL=http://localhost:8081
VITE_SOCIAL_URL=http://localhost:8082
VITE_REALTIME_URL=http://localhost:8083
VITE_CLAN_SDK_URL=http://127.0.0.1:18080/v1/clan-sdk.js
```

Use the game ID associated with the backend's `CLAN_GAME_API_KEY`. Run the SDK container separately
on port 18080, then `npm run dev`. Restart Vite after changing settings. Production assets need a
rebuild when public URLs change. These URLs must be reachable by the player's browser. Configure
the services to allow the game's origin. HTTPS deployments require an HTTPS SDK URL.

Express derives its production CSP from these public environment values. Supply the same values
when starting a built game so the allowed script and service origins match the frontend.

### Docker build and Compose

The two-stage Dockerfile builds only this game and serves the frontend through Express as a
non-root user. It fetches no SDK package or source checkout. From this directory:

```sh
docker build -t harvest-village:script-tag \
  --build-arg VITE_GAME_ID=your-platform-game-id \
  --build-arg VITE_PLATFORM_URL=http://localhost:8081 \
  --build-arg VITE_SOCIAL_URL=http://localhost:8082 \
  --build-arg VITE_REALTIME_URL=http://localhost:8083 \
  --build-arg VITE_CLAN_SDK_URL=http://127.0.0.1:18080/v1/clan-sdk.js .
```

Deployment can replace each public URL, including the SDK script URL. The runtime image keeps
the build's public settings for CSP. API keys remain runtime-only. Environment files, local
databases, and local SDK checkouts are excluded from the context. An optional private registry
configuration can be supplied as `--secret id=npmrc,src=/secure/path/npmrc`.

For Compose, set all five public `VITE_*` values above in the root `.env`, then:

```sh
docker compose build
# Local HTTP cookies only. The container's bridge reaches host-run Platform
# through host.docker.internal; browser URLs remain localhost:8081/8082/8083.
CLAN_PLATFORM_URL=http://host.docker.internal:8081 COOKIE_SECURE=false docker compose up -d --wait
curl -fsS http://localhost:3001/api/health
docker compose down
```

PowerShell uses environment assignments before the start command:

```powershell
docker compose build
$env:CLAN_PLATFORM_URL = 'http://host.docker.internal:8081'
$env:COOKIE_SECURE = 'false'
docker compose up -d --wait
curl.exe -fsS http://localhost:3001/api/health
```

Compose serves the production frontend and API on `127.0.0.1:3001`, includes a
healthcheck, and mounts `game-data` at `/app/data`. Its exact Docker volume name
remains **`harvest-village-data`**, independent of Compose's project name. The
image's `node` user (UID 1000) owns the data directory; a fresh named volume
inherits those permissions. Existing volumes must also be writable by UID 1000.
`DB_PATH` is fixed to `/app/data/harvest.db` in Compose. `docker compose down`
preserves progress; **do not use `down -v`** when keeping accounts and farms.
For HTTPS, keep `COOKIE_SECURE=true` and configure `APP_ORIGIN`/`TRUST_PROXY`
for the actual origin and reverse proxy.

`CLAN_GAME_API_KEY` is passed only to the running server from the existing
environment configuration. There is no API-key build argument. Public settings
are embedded at build time and retained in the image for CSP. All four service/
game build arguments fail clearly when empty, as does an explicitly empty
`VITE_CLAN_SDK_URL`. The compiled TypeScript, Vite assets and production JS-only
dependencies are built on the builder's native architecture. Each target uses
its own `node:22-alpine` runtime, including its built-in `node:sqlite`.

The production image integration test creates a **new isolated volume**, runs
health/static-asset checks, verifies the non-root runtime and SQLite, registers a
throwaway player, buys/plants/grows/harvests/sells a carrot, recreates the container
with the same volume, then verifies the account/password, existing session,
coins, XP, inventory and crop timestamps. It never uses `harvest-village-data`.

```sh
IMAGE_CHECK_IMAGE=harvest-village:local IMAGE_CHECK_PORT=13001 npm run test:image
# Optional: leave its disposable container running for manual browser checks.
IMAGE_CHECK_IMAGE=harvest-village:local npm run test:image -- --keep
```

In PowerShell set `$env:IMAGE_CHECK_IMAGE` and `$env:IMAGE_CHECK_PORT` separately.
The test prints cleanup commands when `--keep` is used. This verifies the real
game image and SQLite, not mocked gameplay. Hosted SDK availability, published
config, the player-token bridge and Social/Realtime connectivity must also be
checked in a browser with those services running; API-only image tests do not
claim those integrations passed.

### GitLab image pipeline

The `.gitlab-ci.yml` adds `test` and `images` jobs. Tests run on Node 22 Alpine;
the image job follows the team's Docker 27/DinD + named TLS-context buildx
convention. The accessible clan-frontend CI publishes the UI npm package rather
than images, so the Docker image setup follows the existing clan-backend job.
Jobs run automatically on `main` (not on `develop`, to save runner minutes) and can be
started manually in merge request pipelines. The runner needs privileged DinD with shared `/certs/client`.

Set these **public CI/CD variables**, available to each image job you run:

| Variable | Meaning |
| --- | --- |
| `VITE_GAME_ID` | Registered game ID matching the server's runtime API key |
| `VITE_PLATFORM_URL` | Browser-accessible Platform HTTP(S) base |
| `VITE_SOCIAL_URL` | Browser-accessible Social HTTP(S) base |
| `VITE_REALTIME_URL` | Browser-accessible Realtime HTTP(S) base; SDK derives WS/WSS |
| `VITE_CLAN_SDK_URL` | Hosted classic SDK script URL, e.g. `https://sdk.example.com/v1/clan-sdk.js` |

The `images` job builds `linux/amd64` and `linux/arm64` into one image index at
`$CI_REGISTRY_IMAGE/game`, tagged with `$CI_COMMIT_SHA` and the Docker-safe
`$CI_COMMIT_REF_SLUG`. It adds `latest` only on `main`. Registry login uses GitLab's
predefined `CI_REGISTRY`, `CI_REGISTRY_USER` and `CI_REGISTRY_PASSWORD` variables.
Do not add the Platform API key to public CI variables or build arguments; supply
it only through the deployment's runtime server environment (see "Deploy" below). Actual GitLab job execution, push permissions and the published
multi-platform registry manifest require a CI run; local builds do not establish
publication success.

### Deploy

The game runs on the k3s server as its own Helm release, `clan-game`, at
`https://game.130-61-158-79.sslip.io`. The chart is `deploy/helm/game`; `deploy/deploy.sh <image tag>`
installs it over SSH, and the CI job `deploy` runs that script on `main` after the image was pushed.
Deploying the game changes nothing else on the server (clan-backend, Studio and the SDK have their own releases).

- **One pod, replaced not rolled:** SQLite takes one writer, so the old pod stops before the new one
  starts. A deploy has a few seconds of downtime.
- **Player progress** is the SQLite file on a 1 GiB disk (`clan-game-data`) mounted at `/app/data`. It
  survives a pod restart, a deploy and `helm uninstall`. Only deleting that claim by hand erases it.
- **The Platform API key** is given at deploy time as `CLAN_GAME_API_KEY` and stored in the cluster
  Secret `clan-game`. In CI it is a project variable: Protected, Masked, environment scope
  `game-production`. It is never a `VITE_` variable, a build argument or a file in git.
- **Runtime settings** the chart sets: `TRUST_PROXY=true` (it is behind Traefik),
  `APP_ORIGIN=https://game.<domain>` and `CLAN_PLATFORM_URL` (from `values-prod.yaml`).
- **The public `VITE_` values** are baked into the image by the `images` job, so changing one of them
  needs a new image, not only a deploy.

By hand, from Git Bash, with the key in the environment:

```sh
CLAN_GAME_API_KEY=... deploy/deploy.sh <commit sha>
```

Check it on the server:

```sh
sudo KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl -n clan get pods -l app.kubernetes.io/name=clan-game
sudo KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl -n clan logs deploy/clan-game --tail=50
```

To run this image on a free local port:

```sh
docker volume create harvest-village-data
docker run -d --init --name harvest-village -p 3001:3001 \
  --env CLAN_GAME_API_KEY \
  --env CLAN_PLATFORM_URL=http://host.docker.internal:8081 \
  --env APP_ORIGIN=http://localhost:3001 --env COOKIE_SECURE=false \
  --add-host host.docker.internal:host-gateway \
  --mount type=volume,source=harvest-village-data,target=/app/data \
  harvest-village:script-tag
```

Set `CLAN_GAME_API_KEY` in the shell before running that command. The database is stored in
`/app/data/harvest.db`. An existing named volume is reused. Host-run games use their configured
database file instead; their accounts are not automatically copied into a Docker volume.

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
identity isolation, overrides, failures/timeouts, and secret filtering. These tests use mock Platform
responses and do not verify deployed credentials or connectivity.

## Limitations

- Single-process design: the rate limiter is in memory and SQLite allows one writer at a time. Fine for a demo and small games; use Postgres + shared rate limiting to scale out.
- No email, password reset or "change password"; username/password only.
- Crops yield 1 item per harvest and the farm size and unlock levels are fixed in code.
- The server never auto-advances anything, so "offline growth" is just timestamps passing; there is no notification when crops ripen.
- `node:sqlite` is still flagged experimental by Node, though stable in practice for this use.
- Cross-process race safety relies on SQLite's `BEGIN IMMEDIATE` plus conditional updates; parallel-request tests run against one Node process, not several.
