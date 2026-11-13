import "server-only";

/**
 * Every rate limit, in one place (06 §4, §7). A rule = at most `limit` requests per `windowMs`
 * (sliding window) per subject (a user id or an IP, see 06 §3). Each one can be overridden at
 * startup with RATE_LIMIT_OVERRIDES (env.ts), e.g. tests use tiny limits.
 *
 * No imports on purpose: env.ts validates override names against this list.
 */
export type RateLimitRule = { limit: number; windowMs: number };

/**
 * What to do when Redis is connected but doesn't answer in time (7.2 D4):
 *  - reject: 503 RETRY_LATER — security limits (brute force), an unchecked attempt is a risk;
 *  - allow:  let the request through unchecked — budget limits (fairness), one unchecked request
 *            costs nothing, a 503 on a busy instance would.
 * (Redis UNREACHABLE → in-memory limits for every rule.)
 */
export type TimeoutPolicy = "reject" | "allow";
type RuleConfig = RateLimitRule & { onTimeout: TimeoutPolicy };

const MINUTE = 60_000;

export const RATE_LIMIT_RULES = {
  // Sign-in (step 7.3; the email is hashed in the key): (email, IP) → one account from one place; email → one account from
  // anywhere (looser on purpose: a strict one lets an attacker lock a victim out); IP → stuffing.
  "signin.email_ip": { limit: 5, windowMs: 15 * MINUTE, onTimeout: "reject" },
  "signin.email": { limit: 20, windowMs: 15 * MINUTE, onTimeout: "reject" },
  "signin.ip": { limit: 30, windowMs: 15 * MINUTE, onTimeout: "reject" },
  // Sign-up (step 7.3): account farming.
  "signup.ip": { limit: 10, windowMs: 60 * MINUTE, onTimeout: "reject" },
  // Invite-code redeem (step 7.1): brute-force defence; the IP rule is a second layer.
  "redeem.user": { limit: 10, windowMs: 10 * MINUTE, onTimeout: "reject" },
  "redeem.ip": { limit: 50, windowMs: 10 * MINUTE, onTimeout: "reject" },
  // Our API (step 7.2): one budget per request, picked by requireUser (GET → read, else mutation).
  "request.user": { limit: 20, windowMs: MINUTE, onTimeout: "allow" },
  "mutation.user": { limit: 60, windowMs: MINUTE, onTimeout: "allow" },
  "suggestion.user": { limit: 20, windowMs: MINUTE, onTimeout: "allow" },
  "read.user": { limit: 300, windowMs: MINUTE, onTimeout: "allow" },
  // Live stream connects (step 7.4). No cap on CONCURRENT streams in v1 (removed for simplicity).
  "stream.connect.user": { limit: 20, windowMs: MINUTE, onTimeout: "allow" },
} as const satisfies Record<string, RuleConfig>;

export type RateLimitRuleName = keyof typeof RATE_LIMIT_RULES;

export function isRateLimitRuleName(name: string): name is RateLimitRuleName {
  return Object.hasOwn(RATE_LIMIT_RULES, name);
}
