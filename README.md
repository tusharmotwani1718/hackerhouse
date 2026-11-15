# Hacker House

Race-proof team formation for hackathons at scale (~10,000 participants): browse teams, join or
ask to join, invite codes, live updates. Built so that concurrent actions (50 people grabbing the
last seat, double clicks, retries) always end in a correct team.

**Live demo:** <https://hackerhouse-hack4hack.vercel.app> (Vercel + Supabase + Upstash, single
region). It's a demo of the features; every test and the load test below run **locally** on
Docker, never against the demo.

- [Repository layout](#repository-layout)
- [1. Prerequisites](#1-prerequisites)
- [2. Local setup](#2-local-setup)
- [3. Try the app](#3-try-the-app)
- [4. Race + API tests](#4-race--api-tests)
- [5. Load test (k6)](#5-load-test-k6)
- [6. Checks and CI](#6-checks-and-ci)
- [Troubleshooting](#troubleshooting)
- [Scripts](#scripts)

## Repository layout

| Path                         | What                                                                 |
| ---------------------------- | -------------------------------------------------------------------- |
| `apps/web`                   | Next.js app: UI, REST API, live updates (SSE)                        |
| `apps/web/tests`             | Race tests (`race/`) and API tests (`api/`)                          |
| `apps/web/load`              | Load test: seed, server launcher, k6 script                          |
| `apps/docs`                  | Placeholder (empty for now)                                          |
| `packages/db`                | Prisma 7 schema, migrations (incl. hand-written SQL), client factory |
| `packages/ui`                | Shared UI components (shadcn)                                        |
| `packages/typescript-config` | Shared strict TypeScript configs                                     |
| `packages/eslint-config`     | Shared ESLint flat configs                                           |

Stack: Bun + Turborepo, Next.js 16, Prisma 7 / Postgres 17, Redis 8, Better Auth, Zod.

## 1. Prerequisites

| Tool                                                        | Version          | Check            |
| ----------------------------------------------------------- | ---------------- | ---------------- |
| [Bun](https://bun.sh)                                       | 1.3.14           | `bun --version`  |
| [Node.js](https://nodejs.org)                               | 24 (20.9+ works) | `node --version` |
| [Docker](https://docs.docker.com/get-docker/) (+ Compose)   | any recent       | `docker info`    |
| [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/) | only for step 5  | `k6 version`     |

Next.js runs on Node even when started through Bun, so both are needed. Docker must be
**running** (Docker Desktop started) before step 2.

Ports used on `127.0.0.1`: **5433** (Postgres), **6379** (Redis), **3000** (dev app), **3100**
(API tests' app), **3200** (load-test app).

## 2. Local setup

Every command runs from the **repository root**. The commands work in bash, zsh and PowerShell.

**Step 1: clone and install**

```sh
git clone https://github.com/tusharmotwani1718/hackerhouse.git
cd hackerhouse
bun install
```

**Step 2: create the env file**

```sh
cp .env.example .env
```

One `.env` at the root is used by everything (Docker Compose, the app, Prisma, the scripts). Its
defaults match `docker-compose.yml`, so nothing needs editing. Optionally add this line for local
use. Locally there is no proxy setting the client IP, so every sign-up shares one per-IP budget
(10 per hour):

```sh
RATE_LIMIT_OVERRIDES=signup.ip=1000/1h,signin.ip=1000/15m
```

**Step 3: start Postgres and Redis**

```sh
bun run infra:up
```

It returns once both containers are healthy. On the first start, Postgres also creates the test
database `hacker_house_test` (`docker/postgres/init`).

**Step 4: create the tables**

```sh
bun run db:deploy
```

Applies every migration in `packages/db/prisma/migrations` to the dev database `hacker_house`.

**Step 5: create an admin**

```sh
bun run admin create --email admin@example.com --name "Admin"
```

It prompts for a password (8+ characters). Admins can only be created here, never through the
app. `bun run admin --help` lists the other commands.

**Step 6: start the app**

```sh
bun run dev
```

Open <http://localhost:3000>. If a variable in `.env` is missing or malformed, the app stops at
startup and lists the bad variables by name (never their values).

## 3. Try the app

1. **Sign in as the admin** → Hackathons → **create a hackathon** (name, team size).
2. **Open a second browser** (or a private window) → **sign up** a normal user → complete the
   profile (GitHub username + at least one skill) → **register** for the hackathon.
3. Create a team, or join one from the board. With the admin also registered, try:
   - an **OPEN** team: join directly;
   - an **APPROVAL** team: send a request, then approve it as the leader;
   - the **invite code** on the team page: redeem it from the other account;
   - **leave**, **remove a member**, and the team's **activity log**.
4. Keep both windows open: changes appear in the other one **live** (Server-Sent Events over
   Redis pub/sub), without reloading.

## 4. Race + API tests

**What they test**

- **Race** (`apps/web/tests/race`, 3 tests): 50 people join the last free seat at once → exactly
  one wins; one user joins two teams at once → exactly one join; the same request sent 50 times
  with one idempotency key → one join and 49 identical replays.
- **API** (`apps/web/tests/api`, 94 tests in 11 files): every endpoint over real HTTP, covering
  auth and CSRF, profile, registering, team create, join and leave, requests, invite codes,
  leader tools, reads and pagination, who may see what, and rate limits.

**How they run**

- Against a **production build** of the app (`next build`, then `next start` on port **3100**),
  not the dev server.
- On their **own** database (`hacker_house_test`) and Redis database (1). Your dev data (database
  `hacker_house`, Redis database 0) is never touched.
- Every test starts from **empty tables**: the tests TRUNCATE everything. They refuse to run
  against a database whose name doesn't end in `_test`.
- The dev server on port 3000 can keep running meanwhile.

**Step 1: make sure the infrastructure is up**

```sh
bun run infra:up
```

**Step 2: run the race tests**

```sh
bun run test:race
```

It builds the app first (about 1 minute), then runs the tests. Expected: `3 pass, 0 fail`.

**Step 3: run the API tests**

```sh
bun run test:api
```

It builds again, then runs every file (about 1–2 minutes). Expected: `94 pass, 0 fail`.

**Faster reruns, skipping the build** (only while the app code is unchanged):

```sh
cd apps/web
bun test ./tests/race
bun test ./tests/api
bun test ./tests/api/requests.test.ts          # one file
bun test ./tests/api -t "leave case A"         # tests whose name matches
```

After changing app code, build again (`bun x next build` in `apps/web`, or use the
`test:race` / `test:api` scripts). Otherwise the tests run against the old build.

## 5. Load test (k6)

**What it measures:** 100 people browsing the team board of one hackathon with 2,000 teams and
10,000 users, each pausing 1–3 s between requests. The mix:

- 60%: open the board and page deeper;
- 25%: filter it;
- 15%: search by team name.

**Pass rules** (the k6 thresholds; k6 exits with code 99 if one fails):

- **p95 < 200 ms**: 95% of the requests answer within 200 ms, overall and for each kind of request;
- **< 1% failed** requests;
- **no 429s**: the rate limiter must never kick in.

It uses its own database (`hacker_house_load`), its own Redis database (2) and port **3200**, so
it never touches dev or the tests.

**Step 1: install k6** (once)

| OS      | Command                                                                           |
| ------- | --------------------------------------------------------------------------------- |
| Windows | `winget install k6 --source winget`                                               |
| macOS   | `brew install k6`                                                                 |
| Linux   | see the [k6 install guide](https://grafana.com/docs/k6/latest/set-up/install-k6/) |

Open a **new** terminal afterwards so `k6` is on the PATH, then check it with `k6 version`.

**Step 2: seed the load database** (about 30 s)

```sh
bun run infra:up
bun run load:seed
```

It creates `hacker_house_load` if it doesn't exist and applies the migrations. It then fills the
database with 10,000 users and 2,000 teams in the hackathon `load-jam`, the same data on every
run. It also writes a signed session cookie for every user to `apps/web/load/.output/sessions.json`
(git-ignored), so k6 doesn't have to sign in. Rerun it whenever you want fresh data, or after
changing `BETTER_AUTH_SECRET`: the cookies are signed with it.

**Step 3: start the load-test server**, in **terminal 1**

```sh
bun run load:serve --build
```

`--build` makes a production build first. Leave it out on later runs if the app code hasn't
changed. Wait for `Load server ready on http://localhost:3200`, and keep this terminal open.

**Step 4: run k6**, in **terminal 2**

```sh
bun run load:board
```

It takes about 4 minutes:

- 30 s ramp-up to 100 users;
- 3 min at 100 users;
- 10 s ramp-down.

**Step 5: read the result.** In the summary at the end, each threshold has a ✓ or ✗. The line
to look at:

```
http_req_duration ... p(95)=...ms   ✓ 'p(95)<200'
```

`p(99)` and `max` show how bad the slowest requests were. Stop the server in terminal 1 with
**Ctrl+C** afterwards.

**Variations**

```sh
k6 run -e VUS=10 -e HOLD=20s apps/web/load/board.k6.js   # quick try: 10 users, 20 s
k6 run -e VUS=200 apps/web/load/board.k6.js              # more users
```

For live charts in the browser, set `K6_WEB_DASHBOARD=true` before `k6 run` and open
<http://localhost:5665>.

Results depend on the machine. The app runs as **one** Node process, so a busy laptop (a build,
a video call, other containers) pushes p95 up. Close heavy programs for a fair number.

## 6. Checks and CI

```sh
bun run format:check   # Prettier
bun run lint           # ESLint
bun run typecheck      # TypeScript
```

GitHub Actions (`.github/workflows/ci.yml`) runs these, plus the race and API tests, on every push
to `main` and on every pull request. The tests run against throwaway Postgres 17 and Redis 8
containers. The load test is not part of CI: it is a measurement, run by hand.

## Troubleshooting

| Problem                                          | Fix                                                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `infra:up` fails or hangs                        | Start Docker Desktop. Check that ports 5433 / 6379 are free.                                                                    |
| `Invalid environment configuration`              | `.env` is missing or a value is wrong: `cp .env.example .env`. The message names the variables.                                 |
| `Port 3100 (or 3200) is already in use`          | A previous run's server is still alive: stop it (or end the `node` process on that port).                                       |
| `database "hacker_house_test" does not exist`    | The Postgres volume predates the init script: `bun run infra:reset`, then `infra:up` and `db:deploy` (this deletes local data). |
| k6 `setup` says 401                              | The cookies don't match the server: run `bun run load:seed` again, then restart `load:serve`.                                   |
| k6 `setup` says 404                              | No `load-jam` hackathon: run `bun run load:seed`.                                                                               |
| Sign-up locally answers 429 after a few accounts | Add the `RATE_LIMIT_OVERRIDES` line from step 2 of the setup to `.env` and restart `bun run dev`.                               |
| `k6` not found right after installing            | Open a new terminal (PATH is read at start).                                                                                    |

To start over completely: `bun run infra:reset` (**deletes** all local databases), then
`bun run infra:up` and `bun run db:deploy`.

## Scripts

| Command                           | What                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------- |
| `bun run dev`                     | Run all apps in dev mode                                                        |
| `bun run build`                   | Build all apps                                                                  |
| `bun run lint`                    | Lint all workspaces                                                             |
| `bun run typecheck`               | Type-check all workspaces                                                       |
| `bun run format` / `format:check` | Format / check formatting with Prettier                                         |
| `bun run infra:up` / `infra:down` | Start (wait for healthy) / stop the local databases, keeping data               |
| `bun run infra:reset`             | Stop and **delete** database volumes (init scripts re-run)                      |
| `bun run infra:logs`              | Follow Postgres/Redis logs (lock waits > 1s are logged)                         |
| `bun run db:generate`             | Generate the Prisma client (also runs automatically before dev/build/typecheck) |
| `bun run db:migrate -- --name x`  | Create + apply a migration (`--create-only` to hand-edit SQL first)             |
| `bun run db:deploy`               | Apply pending migrations                                                        |
| `bun run db:studio`               | Open Prisma Studio                                                              |
| `bun run admin <command>`         | Admin CLI: `create`, `promote`, `demote`, `list`, `reset-password` (`--help`)   |
| `bun run test:race`               | Build, then the race tests                                                      |
| `bun run test:api`                | Build, then the API tests                                                       |
| `bun run load:seed`               | Fill the load-test database (10,000 users, 2,000 teams)                         |
| `bun run load:serve [--build]`    | Start the production build on :3200 for the load test                           |
| `bun run load:board`              | Run the k6 board load test (needs `load:serve` running)                         |

Passwords are never passed as command-line arguments: the admin CLI prompts for them, or reads one
from standard input with `--password-stdin`. `reset-password` also signs the user out everywhere.
