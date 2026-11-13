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
 *    commands), opened at server startup by start() (instrumentation-node.ts, 6.2 D4); the
 *    first subscribe() also calls it, as a safety net.
 *  - Listening (6.2 D4): `listening` is true only while SUBSCRIBE is confirmed on a live
 *    connection. ready() waits for it, so a stream never says "fetch your snapshot" while this
 *    instance can't hear changes. Every time listening (re)starts, all streams get a resync:
 *    whatever was published while we were deaf is gone (pub/sub stores nothing).
 */
export class RedisEventBus implements EventBus {
  private readonly local = new InMemoryEventBus();
  private subscriber: RedisClient | null = null;
  /** SUBSCRIBE confirmed on a live connection (see ready()). */
  private listening = false;
  /** ready() callers waiting for `listening`. */
  private waiters: Array<() => void> = [];

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
    this.start();
    return this.local.subscribe(channels, listener);
  }

  ready(): Promise<void> {
    this.start();
    if (this.listening && this.subscriber?.isReady) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  /** For probes: how many streams this instance is serving. */
  get listenerCount(): number {
    return this.local.listenerCount;
  }

  start(): void {
    if (this.subscriber) return;
    // Same URL/options as the command client, but it may queue: SUBSCRIBE must be (re)sent once
    // connected. connect() keeps retrying (reconnectStrategy) until Redis is reachable, so a
    // Redis outage at boot just delays listening; it never kills the subscriber.
    const sub = getRedis().duplicate({
      disableOfflineQueue: false,
      socket: { connectTimeout: 2_000, reconnectStrategy },
    });
    this.subscriber = sub;

    let readyBefore = false;
    sub.on("error", (err: unknown) => logger.warn("redis (subscriber) error", { err }));
    sub.on("reconnecting", () => {
      // The connection is gone: deaf until the next confirmed (re)subscribe.
      this.listening = false;
      logger.warn("redis (subscriber) reconnecting");
    });
    sub.on("end", () => {
      this.listening = false;
    });
    sub.on("ready", () => {
      // The FIRST ready comes before our SUBSCRIBE is even sent: the connect chain below
      // handles it. Later readies are reconnects: node-redis re-sends SUBSCRIBE itself.
      if (!readyBefore) {
        readyBefore = true;
        return;
      }
      logger.info("redis (subscriber) reconnected");
      // node-redis 6.3.1 confirms the re-SUBSCRIBE before emitting `ready`, but that is an
      // internal detail: a PING reply proves it (replies come back in command order).
      sub
        .ping()
        .then(() => this.markListening("subscriber-reconnected"))
        .catch((err: unknown) => logger.warn("redis (subscriber) ping failed", { err }));
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
      .then(() => this.markListening("subscriber-started"))
      .catch((err: unknown) => logger.warn("redis (subscriber) start failed", { err }));
  }

  /** SUBSCRIBE is confirmed: release waiting streams, tell open streams to resync. */
  private markListening(reason: string): void {
    this.listening = true;
    logger.info("redis (subscriber) listening", { channel: this.redisChannel, reason });
    // Resync first: streams still WAITING ignore it (they haven't fetched a snapshot yet) and
    // send stream.ready instead once released below; open streams refetch.
    this.local.broadcastResync(reason);
    for (const resolve of this.waiters.splice(0)) resolve();
  }
}
