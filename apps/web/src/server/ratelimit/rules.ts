import "server-only";

/**
 * Every rate limit, in one place (06 §4, §7). A rule = at most `limit` requests per `windowMs`
 * (sliding window) per subject (a user id or an IP, see 06 §3). Each one can be overridden at
 * startup with RATE_LIMIT_OVERRIDES (env.ts), e.g. tests use tiny limits.
 *
 * No imports on purpose: env.ts validates override names against this list.
 */
export type RateLimitRule = { limit: number; windowMs: number };

const MINUTE = 60_000;

export const RATE_LIMIT_RULES = {
  // Sign-in (step 7.3): (email, IP) → one account from one place; email → one account from
  // anywhere (looser on purpose: a strict one lets an attacker lock a victim out); IP → stuffing.
  "signin.email_ip": { limit: 5, windowMs: 15 * MINUTE },
  "signin.email": { limit: 20, windowMs: 15 * MINUTE },
  "signin.ip": { limit: 30, windowMs: 15 * MINUTE },
  // Sign-up (step 7.3): account farming.
  "signup.ip": { limit: 10, windowMs: 60 * MINUTE },
  // Invite-code redeem (step 7.1): brute-force defence; the IP rule is a second layer.
  "redeem.user": { limit: 10, windowMs: 10 * MINUTE },
  "redeem.ip": { limit: 50, windowMs: 10 * MINUTE },
  // Our API (step 7.2).
  "request.user": { limit: 20, windowMs: MINUTE },
  "mutation.user": { limit: 60, windowMs: MINUTE },
  "suggestion.user": { limit: 20, windowMs: MINUTE },
  "read.user": { limit: 300, windowMs: MINUTE },
  // Live stream connects (step 7.4); the concurrent cap is separate (stream-slots.ts).
  "stream.connect.user": { limit: 20, windowMs: MINUTE },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitRuleName = keyof typeof RATE_LIMIT_RULES;

export function isRateLimitRuleName(name: string): name is RateLimitRuleName {
  return Object.hasOwn(RATE_LIMIT_RULES, name);
}
