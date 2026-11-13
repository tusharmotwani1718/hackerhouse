import "server-only";

import { ErrorReply } from "redis";

import { getRequestContext } from "../core/context";
import { AppError } from "../core/errors";
import { logger } from "../core/logger";
import { getRedis } from "../core/redis";
import { getEnv } from "../env";
import { MemorySlidingWindow, type MemoryCheck } from "./memory";
import { RATE_LIMIT_RULES, type RateLimitRule, type RateLimitRuleName } from "./rules";
import { toDecision, type WindowDecision } from "./sliding-window";

/** One limit to check: a rule from rules.ts + whose budget (a user id, an IP, …). */
export type LimitCheck = { rule: RateLimitRuleName; subject: string };

/**
 * A healthy Redis answers in ~1 ms. A HUNG one (connected, not answering) must not make requests
 * hang. Our own timer — node-redis's `timeout` command option only covers the time BEFORE a
 * command is written to the socket (6.3.1 drops the timer once it is sent), and with a hung Redis
 * the socket is still up, so commands are sent at once and then wait for a reply forever.
 */
const REDIS_TIMEOUT_MS = 100;

/**
 * redis = normal; memory = Redis unreachable, in-memory limits; slow = Redis didn't answer in
 * time, requests rejected. Only used to log each CHANGE once (not every request).
 */
type LimiterMode = "redis" | "memory" | "slow";
type LimiterState = { memory: MemorySlidingWindow; mode: LimiterMode };

class RedisTimeoutError extends Error {
  override readonly name = "RedisTimeoutError";
}

/** Reject after `ms`. The late reply (if any) is ignored; race() handles its rejection too. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new RedisTimeoutError(`Redis did not answer within ${ms} ms`)),
      ms,
    );
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

function switchMode(s: LimiterState, mode: LimiterMode, err?: unknown): void {
  if (s.mode === mode) return;
  s.mode = mode;
  if (mode === "redis") logger.info("rate limiter: Redis answers again, limits are shared");
  if (mode === "memory") {
    logger.warn("rate limiter: Redis unreachable, using in-memory limits (per instance)", { err });
  }
  if (mode === "slow") {
    logger.warn("rate limiter: Redis too slow, rejecting limited requests (503)", { err });
  }
}

// Cached on globalThis: dev hot reloads keep the fallback counters and the current mode.
const g = globalThis as unknown as { __hhRateLimit?: LimiterState };
const state = (): LimiterState =>
  (g.__hhRateLimit ??= { memory: new MemorySlidingWindow(), mode: "redis" });

/** The rule's limit after RATE_LIMIT_OVERRIDES. */
export function ruleOf(name: RateLimitRuleName): RateLimitRule {
  return getEnv().RATE_LIMIT_OVERRIDES[name] ?? RATE_LIMIT_RULES[name];
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
 *  - TOO SLOW (no answer within REDIS_TIMEOUT_MS) → reject the request with 503 RETRY_LATER.
 *    Not memory: the timer runs on our own (single) thread, so under load it also fires when
 *    Redis answered but we hadn't processed the reply yet — falling back to fresh in-memory
 *    counters then let extra requests through (a 50-request burst passed 6 of a limit of 3).
 *    The late script may still run in Redis: the rejected attempt is then counted (stricter).
 */
async function decide(checks: readonly MemoryCheck[]): Promise<WindowDecision> {
  const s = state();
  try {
    const reply = await withTimeout(
      getRedis().slidingWindow(
        checks.map((check) => check.key),
        checks.flatMap((check) => [String(check.limit), String(check.windowMs)]),
      ),
      REDIS_TIMEOUT_MS,
    );
    switchMode(s, "redis");
    return toDecision(reply);
  } catch (err) {
    if (err instanceof RedisTimeoutError) {
      switchMode(s, "slow", err);
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
