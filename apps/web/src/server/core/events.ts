import "server-only";

import { logger } from "./logger";

/**
SSE Events with payload to sync the client connections
 */
export type DomainEvent = {
  /** e.g. `hackathon:{id}` or `user:{id}` (03 §0.5). */
  channel: string;
  type: string;
  payload: unknown;
};

export interface EventPublisher {
  publish(events: readonly DomainEvent[]): Promise<void>;
}

/** Until Phase 6 (Redis pub/sub), events are only logged. */
const logPublisher: EventPublisher = {
  async publish(events) {
    for (const event of events) {
      logger.info("event published", { channel: event.channel, type: event.type });
      logger.debug("event payload", { type: event.type, payload: event.payload }); // LOG_LEVEL=debug
    }
  },
};

let publisher: EventPublisher = logPublisher;

export function setEventPublisher(next: EventPublisher): void {
  publisher = next;
}

export function getEventPublisher(): EventPublisher {
  return publisher;
}
