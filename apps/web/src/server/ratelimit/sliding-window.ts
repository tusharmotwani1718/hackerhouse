import "server-only";

import { defineScript, type CommandParser } from "redis";

/**
 * Sliding-window counter (06 §2), checked for several rules at once, ALL OR NOTHING (7.1 D2).
 *
 * Per (rule, subject) there is one Redis HASH, `rl:{rule}:{subject}`, with one field per window:
 * `w<index>` = requests counted in window number <index> (index = floor(now / window)).
 * Estimate for "the last `window` ms" = current + previous × (part of the previous window still
 * inside it). Example, 60/min at 15 s into the window: 20 + 50 × 45/60 = 57.5 → one more fits.
 *
 * Why a Lua script: Redis runs a script as ONE command — nothing else runs on Redis in between —
 * so read → compare → increment can't race (N parallel requests can't all see "9 used" and all
 * pass). Why a hash: the window index comes from Redis TIME inside the script (one clock for every
 * instance, D3), so the script can't name per-window KEYS up front; it gets one fixed key per
 * rule and picks fields inside it (KEYS stays honest → Cluster-compatible).
 *
 * Input:  KEYS[i] = hash key of rule i;  ARGV[2i-1] = limit i, ARGV[2i] = window ms i.
 * Output: { allowed (1|0), rule index (1-based), limit, remaining, resetMs, retryAfterMs }
 *   allowed → the rule with the FEWEST remaining requests (what the headers show);
 *   denied  → the denied rule with the LONGEST wait; nothing was incremented.
 * Integers only: Redis turns Lua numbers into integers (decimals are truncated), so every
 * returned value is rounded explicitly.
 */
export const SLIDING_WINDOW_LUA = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)

local rules = {}
local denied, deniedRule, longestWait = false, 1, -1
local tightRule, tightRemaining = 1, nil

for i = 1, #KEYS do
  local limit = tonumber(ARGV[2 * i - 1])
  local window = tonumber(ARGV[2 * i])
  local index = math.floor(now / window)
  local elapsed = now - index * window
  local cur = tonumber(redis.call('HGET', KEYS[i], 'w' .. index) or '0')
  local prev = tonumber(redis.call('HGET', KEYS[i], 'w' .. (index - 1)) or '0')
  local estimate = cur + prev * (window - elapsed) / window
  rules[i] = { limit = limit, window = window, index = index, elapsed = elapsed }

  if estimate + 1 > limit then
    denied = true
    -- How long until one more request fits (estimate + 1 <= limit)?
    local wait
    if cur + 1 <= limit then
      -- Only the previous window's share is too big: wait until it has decayed enough.
      wait = window * (1 - (limit - 1 - cur) / prev) - elapsed
    else
      -- This window alone is full: wait for the next one, then for this one's share to decay.
      wait = (window - elapsed) + math.max(0, window * (1 - (limit - 1) / cur))
    end
    wait = math.max(1, math.ceil(wait))
    if wait > longestWait then longestWait, deniedRule = wait, i end
  else
    local remaining = math.floor(limit - (estimate + 1))
    if tightRemaining == nil or remaining < tightRemaining then
      tightRule, tightRemaining = i, remaining
    end
  end
end

if denied then
  local r = rules[deniedRule]
  return { 0, deniedRule, r.limit, 0, r.window - r.elapsed, longestWait }
end

for i = 1, #KEYS do
  local r = rules[i]
  redis.call('HINCRBY', KEYS[i], 'w' .. r.index, 1)
  -- Drop the window before the previous one (the only stale field that can still exist: the
  -- whole hash expires 2 windows after its last write).
  redis.call('HDEL', KEYS[i], 'w' .. (r.index - 2))
  redis.call('PEXPIRE', KEYS[i], 2 * r.window)
end

local r = rules[tightRule]
return { 1, tightRule, r.limit, tightRemaining, r.window - r.elapsed, 0 }
`;

/**
 * Registered on the command client (core/redis.ts) as `slidingWindow(keys, args)`: node-redis
 * sends EVALSHA (just the script's hash) and, if Redis doesn't know the script yet (first call,
 * or after a Redis restart), sends the script itself once.
 */
export const SLIDING_WINDOW_SCRIPT = defineScript({
  SCRIPT: SLIDING_WINDOW_LUA,
  parseCommand(parser: CommandParser, keys: string[], args: string[]) {
    parser.pushKeysLength(keys); // numkeys, then the keys
    parser.push(...args);
  },
  transformReply: undefined as unknown as () => unknown,
});

/** One evaluation's result (the same shape from Redis and from the in-memory fallback). */
export type WindowDecision = {
  allowed: boolean;
  /** 0-based index into the checks passed in. */
  ruleIndex: number;
  limit: number;
  remaining: number;
  resetMs: number;
  retryAfterMs: number;
};

export function toDecision(reply: unknown): WindowDecision {
  const values = (reply as unknown[]).map(Number);
  const at = (i: number) => values[i] ?? 0;
  return {
    allowed: at(0) === 1,
    ruleIndex: at(1) - 1,
    limit: at(2),
    remaining: at(3),
    resetMs: at(4),
    retryAfterMs: at(5),
  };
}
