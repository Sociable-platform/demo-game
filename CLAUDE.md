# demo-game (Harvest Village)

A farming browser game and the demo game of Sociable: it shows a real game with its own accounts adding the Sociable widget. npm workspaces: `backend/` (Express 5 + TypeScript, `zod`, `helmet`, SQLite via `node:sqlite`) and `frontend/` (React + Vite, plain JavaScript, plain CSS). Read `README.md` first; the reference is in `docs/` (running, how to play, architecture, Clan integration, deployment, limitations).

The Sociable backend is `../clan-backend`, Studio `../clan-frontend`, the SDK `../clan-sdk`.

## Rules

1. **The server is the authority.** Coins, inventory, crop growth, XP and rewards are decided and validated on the server; the client only shows and asks. Never trust a value the browser sends.
2. **Game numbers live in `backend/src/game/catalog.ts`** (prices, grow times, XP, unlocks). Change them there, not in components.
3. **Validate every request body with `zod`.** Keep the existing error shape of the API.
4. **SQLite has one writer.** Money and inventory changes run in `BEGIN IMMEDIATE` with conditional updates, so two requests cannot spend the same coins. Schema changes are new migration files, applied on startup; never edit one that has run.
5. **The Sociable API key stays on the server** (`CLAN_GAME_API_KEY`). The browser gets only `{ "token": "..." }` from `POST /api/clan/token`, after the game's own login. The game session cookie is not a Clan token.
6. The widget is loaded with a script tag (`VITE_CLAN_SDK_URL`), not an npm dependency on the SDK. A failed SDK load shows an error in the panel; farming keeps working.
7. Demo accounts (`demo_alice`, `demo_bob`) and their routes exist only when `NODE_ENV` is not `production`. Keep it that way.

## Checks

Node 22.13 or newer.

```bash
npm install
npm test          # backend and frontend tests
npm run e2e       # starts a real server and plays the whole loop
npm run build
```

Run `npm test` and `npm run e2e` before every MR. The image test: `docs/running.md`.

## Deploy

**Every merge to `main` is deployed** (`deploy/deploy.sh`, chart in `deploy/helm/game`). One pod, replaced rather than rolled, because SQLite takes one writer: a deploy has a few seconds of downtime. Player progress is the SQLite file on the `clan-game-data` volume; never delete it. The API key is given at deploy time, never committed. Details: `docs/deployment.md`.

## Git conventions

- **Branches:** `<category>/<JIRA-ID>-<short-description>`; category lowercase (`feat fix hotfix refactor test docs ci chore release`), Jira ID uppercase (this project: `TEAM-nn`), description lowercase hyphenated 2-4 words. `chore`/`release` need no ticket ID.
- **Long-lived:** `main` and `develop`, both protected. Never push to them; branch from the latest `develop`, one feature or fix per branch, MR into `develop`, delete the branch after merge. `develop` is merged into `main` for a release.
- **Commits:** Conventional Commits, `type(scope): subject`, imperative present tense, no trailing period, first line <= 72 chars; add the ticket, e.g. `fix(chat): keep the draft after a failed send (TEAM-123)`.
- **MRs:** title in commit format; small and focused; draft for WIP. Description: `## Summary`, `## Changes`, `## Type` (Feature / Bug fix / Refactor / Documentation / CI), `## Notes (optional)`.
- **Review:** share the link in the group chat; teammates react; the author resolves discussions; the Team Lead gives the only formal approval; the author merges into `develop`. Prefix feedback `blocking:` / `suggestion:`.
- Never commit secrets (`.env`, keys, tokens, `*.pem`) or broken code. Resolve conflicts locally.

## Jira conventions

- BA writes User Stories; FE/BE create sub-tasks under the story; QA creates `[QA] <story title> Testing` and logs bugs as its sub-tasks.
- Titles: `[FE]`/`[BE]` + imperative verb + what + context; bugs: `[FE]`/`[BE]` + what is broken. Sentence case, <= 80 chars, no trailing punctuation.
- Description before IN PROGRESS: `## What to deliver` (2-3 sentences) and `## Done when` (testable checkboxes).
- Status: `BLOCKED -> TO DO -> IN PROGRESS -> RESOLVED (ON REVIEW) -> QA REVIEW -> DONE`, with a comment on every change (In Progress -> Resolved: `MR opened. / MR: <link> / Branch: <name> / What changed: <one sentence>`).
