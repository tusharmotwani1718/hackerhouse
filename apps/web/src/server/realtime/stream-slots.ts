import "server-only";

import { getEnv } from "../env";

/**
 * Concurrent-stream cap per user (06 §3: max 5 open streams, i.e. tabs). Every stream takes a
 * slot before it opens and gives it back exactly once when it closes (6.2 D7, D8).
 *
 * Phase 7 replaces the implementation with the Redis sorted set from 06 §4.1 (one cap across
 * ALL instances; entries of a crashed instance age out because `refresh` stops). The calls stay
 * the same, which is why `refresh` exists already (the heartbeat calls it).
 */
export interface StreamSlots {
  /** Take a slot for this connection; false = the user is at the cap. */
  acquire(userId: string, connId: string): Promise<boolean>;
  /** The connection is still alive (called on every heartbeat). */
  refresh(userId: string, connId: string): void;
  /** Give the slot back. Safe to call for an unknown connection. */
  release(userId: string, connId: string): void;
}

/**
 * Per-instance cap (step 6.2): user → open connection ids, in this process only. With N
 * instances a user can hold up to N × max streams until Phase 7. A crash loses the map along
 * with the streams, so nothing leaks.
 */
export class InMemoryStreamSlots implements StreamSlots {
  private readonly byUser = new Map<string, Set<string>>();

  constructor(private readonly maxPerUser: number) {}

  // Checking and adding happen with no `await` in between: two connects of the same user can't
  // both see "4 open" and both take the 5th slot (one JS thread, no interleaving here).
  async acquire(userId: string, connId: string): Promise<boolean> {
    let open = this.byUser.get(userId);
    if (!open) this.byUser.set(userId, (open = new Set()));
    if (open.size >= this.maxPerUser) return false;
    open.add(connId);
    return true;
  }

  // Nothing to refresh: an in-process entry can't outlive its stream (Phase 7's Redis entries can).
  refresh(): void {}

  release(userId: string, connId: string): void {
    const open = this.byUser.get(userId);
    if (!open) return;
    open.delete(connId);
    if (open.size === 0) this.byUser.delete(userId);
  }

  /** Open streams on this instance (all users), for logs. */
  get openCount(): number {
    let count = 0;
    for (const open of this.byUser.values()) count += open.size;
    return count;
  }
}

/** What callers get: the interface (so Phase 7 can swap the class) + a count for logs. */
export type ProcessStreamSlots = StreamSlots & { readonly openCount: number };

const g = globalThis as unknown as { __hhStreamSlots?: ProcessStreamSlots };

/** The process's slots, cached on globalThis (dev hot reload must not forget open streams). */
export function getStreamSlots(): ProcessStreamSlots {
  return (g.__hhStreamSlots ??= new InMemoryStreamSlots(getEnv().SSE_MAX_STREAMS_PER_USER));
}
