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

Requires [Bun](https://bun.sh) 1.3+.

```sh
bun install
bun run dev        # web app on http://localhost:3000
```

## Scripts

| Command                           | What                                    |
| --------------------------------- | --------------------------------------- |
| `bun run dev`                     | Run all apps in dev mode                |
| `bun run build`                   | Build all apps                          |
| `bun run lint`                    | Lint all workspaces                     |
| `bun run typecheck`               | Type-check all workspaces               |
| `bun run format` / `format:check` | Format / check formatting with Prettier |
