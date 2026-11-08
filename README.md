# Hacker House

Race-proof team formation for hackathons at scale (~10,000 participants).

## Repository layout

| Path                         | What                                                         |
| ---------------------------- | ------------------------------------------------------------ |
| `apps/web`                   | Next.js app: REST API + SSE (UI comes later)                 |
| `apps/docs`                  | Placeholder (empty for now)                                  |
| `packages/typescript-config` | Shared strict TypeScript configs                             |
| `packages/eslint-config`     | Shared ESLint flat configs                                   |
| `specs/`                     | Design specs — start with `specs/result/01_Final_Details.md` |

## Getting started

Requires [Bun](https://bun.sh) 1.3+ and Docker.

```sh
bun install
cp .env.example .env   # single env file for the whole repo (root)
bun run infra:up       # Postgres 18 (127.0.0.1:5433) + Redis (127.0.0.1:6379), waits until healthy
bun run dev            # web app on http://localhost:3000
```

The app validates its environment at startup and exits with a list of invalid variables
(names only, never values) if anything is missing or malformed.

## Scripts

| Command                           | What                                                        |
| --------------------------------- | ----------------------------------------------------------- |
| `bun run dev`                     | Run all apps in dev mode                                    |
| `bun run build`                   | Build all apps                                              |
| `bun run lint`                    | Lint all workspaces                                         |
| `bun run typecheck`               | Type-check all workspaces                                   |
| `bun run format` / `format:check` | Format / check formatting with Prettier                     |
| `bun run infra:up` / `infra:down` | Start (wait for healthy) / stop dev databases, keeping data |
| `bun run infra:reset`             | Stop and **delete** database volumes (init scripts re-run)  |
| `bun run infra:logs`              | Follow Postgres/Redis logs (lock waits > 1s are logged)     |
