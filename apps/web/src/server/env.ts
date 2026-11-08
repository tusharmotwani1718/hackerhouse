import "server-only";

import { z } from "zod";

/**
 * Server environment, validated once at startup (see src/instrumentation.ts).
 * Read config through `env`, never through `process.env` directly.
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

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: urlWithProtocol(["postgres:", "postgresql:"]),
  REDIS_URL: urlWithProtocol(["redis:", "rediss:"]),
});

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
    const reason = issue.code === "invalid_type" ? "is required" : issue.message;
    return `  - ${name} ${reason}`;
  });
  throw new InvalidEnvError(
    `Invalid environment configuration:\n${lines.join("\n")}\n` +
      `Copy .env.example to .env at the repo root and fix the values above.`,
  );
}

export const env: Env = parseEnv();
