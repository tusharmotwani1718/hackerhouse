import "server-only";

import type { WindowDecision } from "./sliding-window";

type Entry = { windows: Map<number, number>; expiresAt: number };
export type MemoryCheck = { key: string; limit: number; windowMs: number };

/**
 * The SAME sliding-window algorithm as SLIDING_WINDOW_LUA, in this process's memory: the fallback
 * while Redis is unreachable (06 §6). Counters are per instance, so with N instances a user gets
 * up to N × the limit during an outage — never fully open, never fully closed.
 *
 * Atomic for free: this runs synchronously on the one JS thread (no `await` inside), so two
 * requests can't interleave between the check and the increment.
 */
export class MemorySlidingWindow {
  private readonly entries = new Map<string, Entry>();
  private lastSweep = 0;

  evaluate(checks: readonly MemoryCheck[], now = Date.now()): WindowDecision {
    this.sweep(now);
    const windows: { check: MemoryCheck; index: number; elapsed: number }[] = [];
    let denied: { at: number; wait: number } | null = null;
    let tight: { at: number; remaining: number } | null = null;

    for (const [at, check] of checks.entries()) {
      const entry = this.live(check.key, now);
      const index = Math.floor(now / check.windowMs);
      const elapsed = now - index * check.windowMs;
      const cur = entry?.windows.get(index) ?? 0;
      const prev = entry?.windows.get(index - 1) ?? 0;
      const estimate = cur + (prev * (check.windowMs - elapsed)) / check.windowMs;
      windows.push({ check, index, elapsed });

      if (estimate + 1 > check.limit) {
        // Same wait formula as the Lua script.
        const raw =
          cur + 1 <= check.limit
            ? check.windowMs * (1 - (check.limit - 1 - cur) / prev) - elapsed
            : check.windowMs -
              elapsed +
              Math.max(0, check.windowMs * (1 - (check.limit - 1) / cur));
        const wait = Math.max(1, Math.ceil(raw));
        if (!denied || wait > denied.wait) denied = { at, wait };
      } else {
        const remaining = Math.floor(check.limit - (estimate + 1));
        if (!tight || remaining < tight.remaining) tight = { at, remaining };
      }
    }

    const decision = (at: number, allowed: boolean, remaining: number, retryAfterMs: number) => {
      const w = windows[at]!;
      return {
        allowed,
        ruleIndex: at,
        limit: w.check.limit,
        remaining,
        resetMs: w.check.windowMs - w.elapsed,
        retryAfterMs,
      };
    };
    if (denied) return decision(denied.at, false, 0, denied.wait);

    for (const { check, index } of windows) {
      let entry = this.live(check.key, now);
      if (!entry) this.entries.set(check.key, (entry = { windows: new Map(), expiresAt: 0 }));
      entry.windows.set(index, (entry.windows.get(index) ?? 0) + 1);
      entry.windows.delete(index - 2);
      entry.expiresAt = now + 2 * check.windowMs;
    }
    return decision(tight?.at ?? 0, true, tight?.remaining ?? 0, 0);
  }

  private live(key: string, now: number): Entry | undefined {
    const entry = this.entries.get(key);
    if (entry && entry.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  /** At most once a minute: forget expired entries, so the map can't grow without bound. */
  private sweep(now: number): void {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [key, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(key);
  }
}
