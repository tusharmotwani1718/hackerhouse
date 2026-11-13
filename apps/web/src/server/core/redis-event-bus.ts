import "server-only";

import { logger } from "./logger";
import { getRedis, reconnectStrategy, type RedisClient } from "./redis";
import { InMemoryEventBus, type DomainEvent, type EventBus, type Listener } from "./events";

/** Wire format on the Redis channel. `v` lets a later format change coexist during a deploy. */
type WireMessage = { v: 1; channel: string; type: string; payload: unknown };

function parseWire(raw: string): DomainEvent | null {
  try {
    const msg = JSON.parse(raw) as Partial<WireMessage>;
    if (msg.v !== 1 || typeof msg.channel !== "string" || typeof msg.type !== "string") return null;
    return { channel: msg.channel, type: msg.type, payload: msg.payload };
  } catch {
    return null;
  }
}

/**
 * Events between instances via Redis pub/sub (step 6.1, 01 §9.1). ONE Redis channel — the
 * "firehose" — carries every event; every instance subscribes once and its local
 * InMemoryEventBus hands each event to the streams of THIS instance that want its channel
 * (the rest are dropped). So it never matters which instance a browser lands on.
 *
 *  - Publish: PUBLISH on the shared command client (app instance) (getRedis()). Local delivery ALWAYS goes
 *    through Redis too — the publishing instance gets its own events back like every other
 *    instance: one delivery path, one order (6.1 D2).
 *  - Receive: a SEPARATE subscriber connection (a subscribed connection accepts no normal
 *    commands), opened lazily on the first subscribe(): no streams → no need to listen.
 *  - Gaps (RESYNC): Redis pub/sub stores nothing. When the subscriber reconnects, events published
 *    meanwhile are gone for every local stream, so every listener gets a resync signal (D6).
 */
export class RedisEventBus implements EventBus {
  private readonly local = new InMemoryEventBus();
  private subscriber: RedisClient | null = null;

  constructor(private readonly redisChannel: string) {}

  async publish(events: readonly DomainEvent[]): Promise<void> {
    const redis = getRedis();
    // Issued in order on one connection → delivered in this order.
    await Promise.all(
      events.map((event) =>
        redis.publish(
          this.redisChannel,
          JSON.stringify({
            v: 1,
            channel: event.channel,
            type: event.type,
            payload: event.payload,
          }),
        ),
      ),
    );
  }

  subscribe(channels: readonly string[], listener: Listener): () => void {
    this.ensureSubscriber();
    return this.local.subscribe(channels, listener);
  }

  /** For probes: how many streams this instance is serving. */
  get listenerCount(): number {
    return this.local.listenerCount;
  }

  private ensureSubscriber(): void {
    if (this.subscriber) return;
    // Same URL/options as the command client, but it may queue: SUBSCRIBE must be (re)sent once
    // connected; node-redis re-subscribes automatically after every reconnect.
    const sub = getRedis().duplicate({
      disableOfflineQueue: false,
      socket: { connectTimeout: 2_000, reconnectStrategy },
    });
    this.subscriber = sub;

    let readyBefore = false;
    sub.on("error", (err: unknown) => logger.warn("redis (subscriber) error", { err }));
    sub.on("reconnecting", () => logger.warn("redis (subscriber) reconnecting"));
    sub.on("ready", () => {
      if (readyBefore) {
        // Reconnected: anything published while we were away is lost for our streams.
        logger.info("redis (subscriber) reconnected");
        this.local.broadcastResync("subscriber-reconnected");
      }
      readyBefore = true;
    });

    void sub
      .connect()
      .then(() =>
        sub.subscribe(this.redisChannel, (raw: string) => {
          const event = parseWire(raw);
          if (!event) {
            logger.warn("event bus: dropped a malformed message", { length: raw.length });
            return;
          }
          this.local.deliver(event);
        }),
      )
      .catch((err: unknown) => logger.warn("redis (subscriber) start failed", { err }));
  }
}
