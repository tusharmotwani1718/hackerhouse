import "server-only";

import { ErrorReply } from "redis";

import { getRequestContext } from "../core/context";
import { AppError } from "../core/errors";
import { logger } from "../core/logger";
import { getRedis, RedisTimeoutError, withRedisTimeout } from "../core/redis";
import { getEnv } from "../env";
import { MemorySlidingWindow, type MemoryCheck } from "./memory";
import {
  RATE_LIMIT_RULES,
  type RateLimitRule,
  type RateLimitRuleName,
  type TimeoutPolicy,
} from "./rules";
import { toDecision, type WindowDecision } from "./sliding-window";

/** One limit to check: a rule from rules.ts + whose budget (a user id, an IP, …). */
export type LimitCheck = { rule: RateLimitRuleName; subject: string };

/**
 * redis = normal; memory = Redis unreachable, in-memory limits; slow = Redis didn't answer in
 * time (503 or unchecked, per rule). Only used to log each CHANGE once (not every request).
 */
type LimiterMode = "redis" | "memory" | "slow";
type LimiterState = { memory: MemorySlidingWindow; mode: LimiterMode };

function switchMode(s: LimiterState, mode: LimiterMode, err?: unknown): void {
  if (s.mode === mode) return;
  s.mode = mode;
  if (mode === "redis") logger.info("rate limiter: Redis answers again, limits are shared");
  if (mode === "memory") {
    logger.warn("rate limiter: Redis unreachable, using in-memory limits (per instance)", { err });
  }
  if (mode === "slow") {
    logger.warn(
      "rate limiter: Redis too slow; security limits answer 503, budget limits let requests through",
      { err },
    );
  }
}

// Cached on globalThis: dev hot reloads keep the fallback counters and the current mode.
const g = globalThis as unknown as { __hhRateLimit?: LimiterState };
const state = (): LimiterState =>
  (g.__hhRateLimit ??= { memory: new MemorySlidingWindow(), mode: "redis" });

/** The rule after RATE_LIMIT_OVERRIDES (an override changes limit/window, not the policy). */
export function ruleOf(name: RateLimitRuleName): RateLimitRule & { onTimeout: TimeoutPolicy } {
  return { ...RATE_LIMIT_RULES[name], ...getEnv().RATE_LIMIT_OVERRIDES[name] };
}

/**
 * The client's IP for IP-keyed rules: ONLY `X-Real-IP`, which our nginx sets and overwrites
 * (06 §3); a client-sent X-Forwarded-For is never read. Missing (local dev without nginx) →
 * `unknown`, one shared bucket (D7).
 */
export function clientIp(req: Request): string {
  const ip = req.headers.get("x-real-ip")?.trim();
  return ip && ip.length <= 64 ? ip : "unknown";
}

/**
 * Count this request against every check, ALL OR NOTHING (D2), or throw 429 RATE_LIMITED.
 * Most endpoints don't call this directly: requireUser() does, with the request's budget (7.2).
 * Call it after auth (user keys need the user) and before validation/the transaction (D9), so a
 * limited request costs no Postgres work. The decision is stored in the request context and
 * route() adds `RateLimit-Limit/-Remaining/-Reset` for the tightest rule (D6).
 */
export async function enforceLimits(checks: readonly LimitCheck[]): Promise<void> {
  const resolved = checks.map((check) => {
    const rule = ruleOf(check.rule);
    return { name: check.rule, key: `rl:${check.rule}:${check.subject}`, ...rule };
  });
  const decision = await decide(resolved);
  // Redis too slow and every rule is a budget limit: let it through unchecked (no headers).
  if (!decision) return;
  const retryAfterSeconds = Math.ceil(decision.retryAfterMs / 1000);

  const context = getRequestContext();
  if (context) {
    context.rateLimit = {
      limit: decision.limit,
      remaining: decision.remaining,
      // Allowed: when the current window ends. Denied: when the next request fits — the
      // window's end can be too early (the previous window's weight still has to decay).
      resetSeconds: decision.allowed ? Math.ceil(decision.resetMs / 1000) : retryAfterSeconds,
    };
  }
  if (!decision.allowed) {
    throw new AppError(
      "RATE_LIMITED",
      `Too many requests. Try again in ${retryAfterSeconds} second${retryAfterSeconds === 1 ? "" : "s"}.`,
      {
        details: { rule: resolved[decision.ruleIndex]?.name, retryAfterSeconds },
        headers: { "Retry-After": String(retryAfterSeconds) },
      },
    );
  }
}

/**
 * Redis first (one budget across all instances). If it can't answer (D4, revised after testing):
 *  - UNREACHABLE (disconnected: the command fails at once) → this instance's memory, the same
 *    algorithm; limits become per instance until Redis is back (06 §6).
 *  - TOO SLOW (no answer within REDIS_TIMEOUT_MS, core/redis.ts) → per rule (7.2 D4): any `reject` rule →
 *    503 RETRY_LATER; all `allow` → null = let the request through unchecked.
 *    Never memory here: the timer runs on our own (single) thread, so under load it also fires
 *    when Redis answered but we hadn't processed the reply yet — falling back to fresh in-memory
 *    counters then let extra requests through (a 50-request burst passed 6 of a limit of 3).
 *    The late script may still run in Redis: that attempt is then counted anyway.
 */
async function decide(
  checks: readonly (MemoryCheck & { onTimeout: TimeoutPolicy })[],
): Promise<WindowDecision | null> {
  const s = state();
  try {
    const reply = await withRedisTimeout(
      getRedis().slidingWindow(
        checks.map((check) => check.key),
        checks.flatMap((check) => [String(check.limit), String(check.windowMs)]),
      ),
    );
    switchMode(s, "redis");
    return toDecision(reply);
  } catch (err) {
    if (err instanceof RedisTimeoutError) {
      switchMode(s, "slow", err);
      if (checks.every((check) => check.onTimeout === "allow")) return null;
      throw new AppError("RETRY_LATER", "Please try again in a moment.", {
        headers: { "Retry-After": "1" },
        cause: err,
      });
    }
    if (err instanceof ErrorReply) {
      // Redis is up but rejected the script: a bug, not an outage. Still limit (memory), but
      // say so loudly on every occurrence.
      logger.error("rate limiter: Redis rejected the script, using in-memory limits", { err });
    } else {
      switchMode(s, "memory", err);
    }
    return s.memory.evaluate(checks);
  }
}
