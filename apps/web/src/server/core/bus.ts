import "server-only";

import { getEnv } from "../env";
import { InMemoryEventBus, type EventBus } from "./events";
import { RedisEventBus } from "./redis-event-bus";

const g = globalThis as unknown as { __hhEventBus?: EventBus };

/**
 * The process's event bus, chosen by EVENT_BUS (default `redis`; `memory` = one process only).
 * Lazy and cached on globalThis like getDb(): nothing connects at import or during
 * `next build`, and dev hot reloads keep one bus (and its Redis connections).
 */
export function getEventBus(): EventBus {
  if (!g.__hhEventBus) {
    const env = getEnv();
    g.__hhEventBus =
      env.EVENT_BUS === "memory" ? new InMemoryEventBus() : new RedisEventBus(env.EVENTS_CHANNEL);
  }
  return g.__hhEventBus;
}
