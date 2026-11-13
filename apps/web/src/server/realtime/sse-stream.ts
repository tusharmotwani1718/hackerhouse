import "server-only";

import { RESYNC_EVENT_TYPE, type DeliveredEvent, type EventBus } from "../core/events";

/**
 * One SSE stream = one browser tab (step 6.2, 05 §5, 01 §9.3). Pure Web Streams, no Next.js:
 * the route only checks auth/limits and wraps the result in a Response.
 *
 * Wire format (one event per block; a blank line ends a block):
 *
 *   retry: 6421                     random 2–10 s per connection: spreads reconnect storms (D2)
 *   event: stream.ready             "you are subscribed now: fetch your snapshot" (D1, D4)
 *   data: {"channels":[…],"heartbeatMs":25000}
 *   event: team.updated             a domain event: name = event type, data = its payload
 *   data: {…}
 *   : hb                            heartbeat comment, ignored by EventSource (D3)
 *   event: stream.resync            this instance may have missed events: fetch the snapshot again
 *   event: stream.closing           the server ends the stream on purpose (lifetime, D5)
 *
 * Client rule: `stream.ready` or `stream.resync` → fetch the REST snapshot; apply events only if
 * their `version` is newer than what is on screen.
 *
 * `data:` is always ONE line: JSON.stringify never emits a raw newline (it writes `\n`), and a
 * raw newline would end the SSE field early.
 */

export type CloseReason =
  /** The client disconnected (request aborted / response cancelled). */
  | "client-gone"
  /** The stream reached its lifetime (D5); the client reconnects after `retry`. */
  | "max-lifetime"
  /** The client stopped reading and our queue reached its byte limit (D6). */
  | "slow-consumer"
  /** Enqueueing failed (the stream was already torn down underneath us). */
  | "write-failed";

export type StreamSummary = {
  reason: CloseReason;
  durationMs: number;
  /** Domain/resync events written (heartbeats not counted). */
  events: number;
  bytes: number;
  /** Whether `stream.ready` was ever sent (false = the bus never became ready in time). */
  readySent: boolean;
};

export type EventStreamOptions = {
  bus: EventBus;
  /** Decided by the server, never by the client. */
  channels: readonly string[];
  /** The request's abort signal: fires when the client goes away. */
  signal: AbortSignal;
  heartbeatMs: number;
  /** Exact lifetime of this stream (the caller randomizes it). */
  lifetimeMs: number;
  /** `retry:` value sent to the client (the caller randomizes it). */
  retryMs: number;
  /** Max bytes queued for a client that isn't reading (D6). */
  bufferBytes: number;
  /** Called on every heartbeat that was written (the slot refresh, D8). */
  onHeartbeat?: () => void;
  /** Called exactly once, whatever ended the stream (D7). */
  onClose: (summary: StreamSummary) => void;
};

export function openEventStream(options: EventStreamOptions): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const startedAt = performance.now();

  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;
  let readySent = false;
  let events = 0;
  let bytes = 0;
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let lifetime: ReturnType<typeof setTimeout> | undefined;

  const onAbort = () => close("client-gone");

  /**
   * The ONE way a stream ends (D7). Idempotent: abort and cancel usually both fire for one
   * disconnect, and the slot must be released exactly once.
   */
  function close(reason: CloseReason): void {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    clearTimeout(lifetime);
    options.signal.removeEventListener("abort", onAbort);
    unsubscribe?.();
    unsubscribe = null;
    try {
      if (reason === "slow-consumer" || reason === "write-failed") {
        // error(), not close(): close() waits until the queue drains — never, for a client that
        // stopped reading. error() drops the queue and aborts the response; the client sees a
        // network error, reconnects and resyncs.
        controller.error(new Error(`stream closed: ${reason}`));
      } else {
        controller.close();
      }
    } catch {
      // Already closed/cancelled by the consumer: nothing left to end.
    }
    options.onClose({
      reason,
      durationMs: Math.round(performance.now() - startedAt),
      events,
      bytes,
      readySent,
    });
  }

  /** Queue text for the client, or end the stream if it can't take more (D6). */
  function write(text: string): void {
    if (closed) return;
    // desiredSize = byte limit − bytes still queued. Next only pulls from us as fast as the
    // socket drains, so a client that stops reading makes this reach 0.
    if (controller.desiredSize !== null && controller.desiredSize <= 0) {
      close("slow-consumer");
      return;
    }
    const chunk = encoder.encode(text);
    try {
      controller.enqueue(chunk);
    } catch {
      close("write-failed");
      return;
    }
    bytes += chunk.byteLength;
  }

  function writeEvent(type: string, data: string): void {
    if (closed) return;
    events += 1;
    write(`event: ${type}\ndata: ${data}\n\n`);
  }

  // Bus listener: must not block or throw (write() catches everything).
  const listener = (event: DeliveredEvent) => {
    // Before stream.ready the client hasn't fetched a snapshot, so "fetch it again" means
    // nothing; stream.ready follows as soon as the bus is listening (D4).
    if (event.type === RESYNC_EVENT_TYPE && !readySent) return;
    writeEvent(event.type, event.data);
  };

  return new ReadableStream<Uint8Array>(
    {
      start(c) {
        controller = c;
        if (options.signal.aborted) {
          close("client-gone");
          return;
        }
        options.signal.addEventListener("abort", onAbort, { once: true });

        write(`retry: ${options.retryMs}\n\n`);

        // Subscribe FIRST (D1): from here on, every change that reaches this instance is
        // written to this stream…
        unsubscribe = options.bus.subscribe(options.channels, listener);

        heartbeat = setInterval(() => {
          write(": hb\n\n");
          if (!closed) options.onHeartbeat?.();
        }, options.heartbeatMs);

        lifetime = setTimeout(() => {
          writeEvent("stream.closing", JSON.stringify({ reason: "max-lifetime" }));
          close("max-lifetime");
        }, options.lifetimeMs);

        // …and only once the instance itself is listening (Redis SUBSCRIBE confirmed) tell the
        // client to take its snapshot (D4). Until then: heartbeats only. Not awaited here, so
        // the response (headers + retry) goes out immediately.
        void options.bus.ready().then(() => {
          if (closed) return;
          readySent = true;
          writeEvent(
            "stream.ready",
            JSON.stringify({ channels: options.channels, heartbeatMs: options.heartbeatMs }),
          );
        });
      },
      cancel() {
        close("client-gone");
      },
    },
    new ByteLengthQueuingStrategy({ highWaterMark: options.bufferBytes }),
  );
}
