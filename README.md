# Hacker House

Race-proof team formation for hackathons at scale (~10,000 participants).

## Repository layout

| Path                         | What                                                                 |
| ---------------------------- | -------------------------------------------------------------------- |
| `apps/web`                   | Next.js app: REST API + SSE (UI comes later)                         |
| `apps/docs`                  | Placeholder (empty for now)                                          |
| `packages/db`                | Prisma 7 schema, migrations (incl. hand-written SQL), client factory |
| `packages/typescript-config` | Shared strict TypeScript configs                                     |
| `packages/eslint-config`     | Shared ESLint flat configs                                           |
| `specs/`                     | Design specs — start with `specs/result/01_Final_Details.md`         |

## Getting started

Requires [Bun](https://bun.sh) 1.3+ and Docker.

```sh
bun install
cp .env.example .env   # single env file for the whole repo (root)
bun run infra:up       # Postgres 17 (127.0.0.1:5433) + Redis (127.0.0.1:6379), waits until healthy
bun run db:deploy      # apply migrations
bun run dev            # web app on http://localhost:3000
```

The app validates its environment at startup and exits with a list of invalid variables
(names only, never values) if anything is missing or malformed.

## Scripts

| Command                           | What                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------- |
| `bun run dev`                     | Run all apps in dev mode                                                        |
| `bun run build`                   | Build all apps                                                                  |
| `bun run lint`                    | Lint all workspaces                                                             |
| `bun run typecheck`               | Type-check all workspaces                                                       |
| `bun run format` / `format:check` | Format / check formatting with Prettier                                         |
| `bun run infra:up` / `infra:down` | Start (wait for healthy) / stop dev databases, keeping data                     |
| `bun run infra:reset`             | Stop and **delete** database volumes (init scripts re-run)                      |
| `bun run infra:logs`              | Follow Postgres/Redis logs (lock waits > 1s are logged)                         |
| `bun run db:generate`             | Generate the Prisma client (also runs automatically before dev/build/typecheck) |
| `bun run db:migrate -- --name x`  | Create + apply a migration (`--create-only` to hand-edit SQL first)             |
| `bun run db:deploy`               | Apply pending migrations                                                        |
| `bun run db:studio`               | Open Prisma Studio                                                              |
| `bun run admin <command>`         | Admin CLI: `create`, `promote`, `demote`, `list`, `reset-password` (`--help`)   |

## Admin accounts

Admins can only be created from the command line, never through the API:

```sh
bun run admin create --email you@example.com --name "Your Name"   # prompts for the password
bun run admin list
```

Passwords are never passed as arguments; use the prompt, or pipe one in with `--password-stdin`.
`reset-password` also signs the user out of every session.
