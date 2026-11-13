import "server-only";

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";

import { logger } from "../core/logger";
import { getDb } from "../db";
import { getEnv } from "../env";

const NAME_MAX = 80;

/**
 * Better Auth endpoints we don't use are disabled (404): less attack surface, and one write
 * path for profile data (our PATCH /api/me, step 1.3). Exact-path match. Parameterised paths
 * (`/reset-password/:token`, `/callback/:id`) can't be listed, but are inert: no reset tokens
 * can be issued and no social providers are configured. Re-enable social paths with GitHub.
 */
const DISABLED_PATHS = [
  "/update-user",
  "/delete-user",
  "/delete-user/callback",
  "/change-email",
  "/request-password-reset", // no email provider in v1 → no self-service reset
  "/reset-password",
  "/send-verification-email", // no email verification (R15)
  "/verify-email",
  "/update-session",
  "/verify-password",
  "/change-password", // not needed in v1 (decided in step 7.3: would need its own rate limit)
  "/sign-in/social", // GitHub OAuth comes later
  "/link-social",
  "/unlink-account",
  "/list-accounts",
  "/account-info",
  "/get-access-token",
  "/refresh-token",
];

function createAuth() {
  const env = getEnv();
  const secure = env.BETTER_AUTH_URL.startsWith("https://");

  return betterAuth({
    appName: "Hacker House",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    // Origin check on state-changing requests: only our own site may POST (CSRF layer 2).
    trustedOrigins: [env.BETTER_AUTH_URL],
    database: prismaAdapter(getDb(), { provider: "postgresql" }),

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false, // R15
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: true,
    },

    user: {
      additionalFields: {
        // R14: never settable through the API; admins are made by the CLI (step 1.2).
        role: { type: "string", input: false, required: false, defaultValue: "USER" },
      },
    },

    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // extend at most once a day while active
      // No cookie cache: every request checks the DB → sign-out/revocation is immediate.
      cookieCache: { enabled: false },
    },

    // Route Better Auth's own logs through ours: request id attached, JSON in production.
    logger: {
      log: (level, message, ...args) => {
        const err = args.find((arg) => arg instanceof Error);
        logger[level](`better-auth: ${message}`, err ? { err } : undefined);
      },
    },

    // Our own limiter wraps these routes in Phase 7 (06 §5): Better Auth's is IP+path only.
    rateLimit: { enabled: false },
    disabledPaths: DISABLED_PATHS,

    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const name = typeof user.name === "string" ? user.name.trim() : "";
            if (name.length < 1 || name.length > NAME_MAX) {
              throw new APIError("BAD_REQUEST", {
                message: `Name must be 1-${NAME_MAX} characters.`,
              });
            }
            return { data: { ...user, name } };
          },
        },
      },
    },

    advanced: {
      database: { generateId: false }, // Postgres generates UUIDv7 ids
      ipAddress: { ipAddressHeaders: ["x-real-ip"] }, // set (overwritten) by our nginx
      useSecureCookies: secure, // Secure + __Secure- prefix over HTTPS
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

// One instance per process, created on first use (lazy: `next build` needs no env).
const globalForAuth = globalThis as typeof globalThis & { __hhAuth?: Auth };

export function getAuth(): Auth {
  return (globalForAuth.__hhAuth ??= createAuth());
}
