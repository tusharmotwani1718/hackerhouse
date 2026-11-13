import "server-only";

import { z } from "zod";

/**
 * Server environment, validated once at startup (see src/instrumentation.ts).
 * Read config through `getEnv()`, never through `process.env` directly.
 * Each step adds the variables it introduces here and in the root `.env.example`.
 */

// `abort: true` stops later checks once one fails (Zod 4 runs them all by default),
// so `new URL()` below only ever sees a parseable value.
const urlWithProtocol = (protocols: readonly string[]) =>
  z
    .string()
    .trim()
    .min(1, { error: "is required", abort: true })
    .refine((value) => URL.canParse(value), { error: "must be a valid URL", abort: true })
    .refine(
      (value) => protocols.includes(new URL(value).protocol),
      `must use ${protocols.map((p) => `${p}//`).join(" or ")}`,
    );

// Optional integer with a default. Empty string counts as "not set" (`KEY=` in .env).
const intWithDefault = (defaultValue: number, min: number, max: number) =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce
      .number({ error: "must be a whole number" })
      .int({ error: "must be a whole number" })
      .min(min, { error: `must be >= ${min}` })
      .max(max, { error: `must be <= ${max}` })
      .default(defaultValue),
  );

/** `.env.example` ships a dev secret starting with this; production refuses it. */
const DEV_SECRET_PREFIX = "dev-only-";

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    DATABASE_URL: urlWithProtocol(["postgres:", "postgresql:"]),
    REDIS_URL: urlWithProtocol(["redis:", "rediss:"]),
    LOG_LEVEL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.enum(["debug", "info", "warn", "error"]).default("info"),
    ),

    // Connection pool + transaction timing (see 07_Build_Plan.md §6 for the budget rule).
    DATABASE_POOL_MAX: intWithDefault(10, 1, 50),
    DATABASE_TX_MAX_WAIT_MS: intWithDefault(5_000, 100, 60_000),
    DATABASE_TX_TIMEOUT_MS: intWithDefault(10_000, 100, 120_000),
    DATABASE_LOCK_TIMEOUT_MS: intWithDefault(5_000, 100, 60_000),

    // Better Auth (step 1.1). The secret signs session cookies (HMAC-SHA256).
    BETTER_AUTH_SECRET: z
      .string()
      .min(1, { error: "is required", abort: true })
      .min(32, { error: "must be at least 32 characters (generate: openssl rand -base64 32)" }),
    BETTER_AUTH_URL: urlWithProtocol(["http:", "https:"]),

    // Real-time events (step 6.1). `memory` = one process only (tests / single instance);
    // `redis` = Redis pub/sub between instances. The channel name separates apps sharing one
    // Redis (pub/sub ignores Redis's numbered databases): e.g. tests use hh:events:test.
    EVENT_BUS: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.enum(["redis", "memory"]).default("redis"),
    ),
    // Dev probes (/api/dev/*) are on outside production; this turns them on IN a production
    // build too — for test harnesses only (e.g. the 6.1 two-instance check). Never in a deploy.
    ENABLE_DEV_PROBES: z.preprocess(
      (value) =>
        value === "" || value === undefined ? undefined : value === "1" || value === "true",
      z.boolean().default(false),
    ),
    EVENTS_CHANNEL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z
        .string()
        .regex(/^[A-Za-z0-9:._-]{1,100}$/, { error: "may contain letters, digits and : . _ -" })
        .default("hh:events"),
    ),
  })
  // lock_timeout must fire first: it is the only one that frees a connection blocked inside
  // Postgres, and it yields a clean 55P03 instead of an "expired transaction" error.
  .refine((env) => env.DATABASE_LOCK_TIMEOUT_MS < env.DATABASE_TX_TIMEOUT_MS, {
    path: ["DATABASE_LOCK_TIMEOUT_MS"],
    error: "must be less than DATABASE_TX_TIMEOUT_MS",
  })
  // Never ship the placeholder secret from .env.example.
  .refine(
    (env) => env.NODE_ENV !== "production" || !env.BETTER_AUTH_SECRET.startsWith(DEV_SECRET_PREFIX),
    { path: ["BETTER_AUTH_SECRET"], error: "is the .env.example placeholder; set a real secret" },
  );

export type Env = Readonly<z.infer<typeof schema>>;

export class InvalidEnvError extends Error {
  override readonly name = "InvalidEnvError";
}

function parseEnv(): Env {
  const result = schema.safeParse(process.env);
  if (result.success) return Object.freeze(result.data);

  // Names + reasons only: values may be secrets and must never be logged.
  const lines = result.error.issues.map((issue) => {
    const name = issue.path.join(".") || "(root)";
    const missing = issue.code === "invalid_type" && process.env[name] === undefined;
    const reason = missing ? "is required" : issue.message;
    return `  - ${name} ${reason}`;
  });
  throw new InvalidEnvError(
    `Invalid environment configuration:\n${lines.join("\n")}\n` +
      `Copy .env.example to .env at the repo root and fix the values above.`,
  );
}

let cached: Env | undefined;

/**
 * Lazy on purpose: `next build` imports route modules to collect page data, so validating at
 * import time would make builds require runtime secrets. The server still fails fast — the
 * startup hook (instrumentation-node.ts) calls this before any request is served.
 */
export function getEnv(): Env {
  return (cached ??= parseEnv());
}
