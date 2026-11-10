import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

import { defineConfig, env } from "prisma/config";

// Prisma 7 does not load .env files. Load the repo-root `.env` (single env source, see
// specs/result/07_Build_Plan.md §6); variables already set in the process win.
const rootEnv = path.resolve(import.meta.dirname, "../../.env");
if (existsSync(rootEnv)) {
  for (const [key, value] of Object.entries(parseEnv(readFileSync(rootEnv, "utf8")))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
