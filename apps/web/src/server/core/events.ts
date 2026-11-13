import "server-only";

import { logger } from "./logger";

/**
 * Real-time events (step 6.1, 01 §9). Services return events; runTx publishes them AFTER
 * COMMIT (I6). The bus routes each one by CHANNEL to the open streams that asked for it
 * (`/api/stream`, 6.2). Events are hints: they carry full state + version, and clients resync
 * over REST on every (re)connect, so a lost event only means a briefly stale screen.
 */
export type DomainEvent = {
  /** `hackathon:{id}` (public team changes) or `user:{id}` (private to user), 03 §0.5 / 05 §5. */
  channel: string;
  type: string;
  payload: unknown;
};

/** What a listener receives: the event plus its payload already serialized ONCE (10k streams
 * write the same string instead of re-encoding it 10k times). */
export type DeliveredEvent = DomainEvent & { data: string };

/** Must not block, should not throw (a throw is caught and logged; the others still run). */
export type Listener = (event: DeliveredEvent) => void;

export interface EventBus {
  publish(events: readonly DomainEvent[]): Promise<void>;
  /** Subscribe a listener (an open stream) to channels; returns the unsubscribe function. */
  subscribe(channels: readonly string[], listener: Listener): () => void;
}

/**
 * RESYNC FOR LOST UPDATES
 * Sent to EVERY listener when this instance may have missed events (its Redis subscriber
 * reconnected): the stream tells its page to refetch over REST, as on a reconnect (6.1 D6).
 */
export const RESYNC_EVENT_TYPE = "stream.resync";

/**
 * In-process bus: channel → listeners. On its own for tests / a single instance; inside
 * RedisEventBus it is the LOCAL fan-out (Redis carries events between instances).
 */
export class InMemoryEventBus implements EventBus {
  // channel -> streams list
  private readonly byChannel = new Map<string, Set<Listener>>();

  // publish within the instance, to its connected streams
  async publish(events: readonly DomainEvent[]): Promise<void> {
    for (const event of events) this.deliver(event);
  }

  // subscribe a listener (connected stream) to the list of channels
  subscribe(channels: readonly string[], listener: Listener): () => void {
    const unique = [...new Set(channels)];
    for (const channel of unique) {
      let set = this.byChannel.get(channel);
      // add the channel with no listeners
      if (!set) this.byChannel.set(channel, (set = new Set()));
      // add the listener (connected stream) to the channel subscribed listeners list
      set.add(listener);
    }
    return () => {
      for (const channel of unique) {
        const set = this.byChannel.get(channel);
        set?.delete(listener);
        if (set?.size === 0) this.byChannel.delete(channel);
      }
    };
  }

  /** Deliver one event to the listeners of its channel (synchronously). */
  deliver(event: DomainEvent): void {
    const listeners = this.byChannel.get(event.channel);
    if (!listeners?.size) return;
    this.call(listeners, { ...event, data: JSON.stringify(event.payload ?? null) });
  }

  /** The resync signal to every listener, whatever its channels (each listener once). */
  broadcastResync(reason: string): void {
    const all = new Set<Listener>();
    // all the listeners of all the channels:
    for (const set of this.byChannel.values()) for (const listener of set) all.add(listener);
    if (all.size === 0) return;
    logger.info("event bus: resync broadcast", { reason, listeners: all.size });
    const payload = { reason };
    this.call(all, {
      channel: "*",
      type: RESYNC_EVENT_TYPE,
      payload,
      data: JSON.stringify(payload),
    });
  }

  /** Distinct listeners currently subscribed (for probes/metrics). */
  get listenerCount(): number {
    const all = new Set<Listener>();
    for (const set of this.byChannel.values()) for (const listener of set) all.add(listener);
    return all.size;
  }

  // function to deliever the event to the listener
  private call(listeners: Iterable<Listener>, event: DeliveredEvent): void {
    // Copy first: a listener may unsubscribe (mutate the set) while we iterate.
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (err) {
        logger.error("event listener threw", { type: event.type, channel: event.channel, err });
      }
    }
  }
}

// The process's bus instance: getEventBus() in ./bus.ts (kept separate to avoid an import cycle
// with redis-event-bus.ts, which builds on InMemoryEventBus).
