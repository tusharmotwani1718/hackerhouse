import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

import type { NextConfig } from "next";

/**
 * Single env source for the monorepo: the repo-root `.env` (shared with docker compose and
 * packages/db). Next.js itself only reads `.env*` from apps/web, so load the root file here.
 * Variables already set in the process (real environment, e.g. production containers) win.
 * A missing file is a no-op; validation happens at server startup (src/instrumentation.ts).
 *
 * Not `@next/env`'s loadEnvConfig: it caches its first call (Next's own, for apps/web), so a
 * second call with another directory is ignored unless forceReload, which resets process.env.
 */
function loadRootEnv() {
  const file = path.resolve(import.meta.dirname, "../../.env");
  if (!existsSync(file)) return;
  for (const [key, value] of Object.entries(parseEnv(readFileSync(file, "utf8")))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadRootEnv();

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source (no build step).
  transpilePackages: ["@hacker-house/db", "@hacker-house/ui"],
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;
