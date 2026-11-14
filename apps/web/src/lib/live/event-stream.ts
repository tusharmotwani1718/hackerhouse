/**
 * Browser side of GET /api/stream (step 6.2): a fetch-based SSE reader. Not EventSource, which
 * can't see HTTP statuses and gives up for good on any non-200 (9.x D1). This one:
 *
 *   stream ends (network, server lifetime, instance restart) → reconnect after the server's
 *     `retry:` (2–10 s, randomized per connection so a restart's reconnects spread out)
 *   429 (20 connects/min) → wait Retry-After · 401 → onUnauthorized · 404 → stop
 *   503 / network error → back off with jitter: 2, 4, 8 … 60 s
 *   nothing received for WATCHDOG_MS (no heartbeat: laptop sleep, half-open socket) → reconnect
 *
 * `stream.ready` / `stream.resync` → onReady / onResync: the caller refetches its data (the
 * page was rendered before the stream existed; events alone can't fill that gap).
 */
export type StreamStatus = "connecting" | "live" | "reconnecting" | "offline";

export type StreamHandlers = {
  onStatus: (status: StreamStatus) => void;
  onReady: () => void;
  onResync: () => void;
  onEvent: (type: string, data: unknown) => void;
  onUnauthorized: () => void;
};

/** Two missed 25 s heartbeats + margin. */
const WATCHDOG_MS = 60_000;
const BACKOFF_MAX_MS = 60_000;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });

/** Opens the stream and keeps it open until the returned function is called. */
export function openEventStream(url: string, handlers: StreamHandlers): () => void {
  const stop = new AbortController();
  let retryMs = 3_000; // replaced by the server's `retry:` line
  let failures = 0;
  let everLive = false;

  const backoff = () =>
    Math.min(BACKOFF_MAX_MS, 2_000 * 2 ** Math.max(0, failures - 1)) + Math.random() * 1_000;

  /** One connection. Returns how long to wait before the next one, or null to give up. */
  async function connectOnce(): Promise<number | null> {
    const attempt = new AbortController();
    const abortAttempt = () => attempt.abort();
    stop.signal.addEventListener("abort", abortAttempt);
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const feedWatchdog = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => attempt.abort(), WATCHDOG_MS);
    };

    try {
      let response: Response;
      try {
        response = await fetch(url, {
          signal: attempt.signal,
          headers: { Accept: "text/event-stream" },
          cache: "no-store",
        });
      } catch {
        failures += 1;
        return backoff();
      }

      if (response.status === 401) {
        handlers.onUnauthorized();
        return null;
      }
      if (response.status === 404) return null;
      if (response.status === 429) {
        failures += 1;
        const seconds = Number(response.headers.get("Retry-After"));
        return seconds > 0 ? seconds * 1_000 + Math.random() * 1_000 : backoff();
      }
      if (!response.ok || !response.body) {
        failures += 1;
        return backoff();
      }

      let sawReady = false;
      let buffer = "";
      let event = "message";
      let data: string[] = [];
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      feedWatchdog();

      const dispatch = () => {
        const type = event;
        const payload = data.join("\n");
        event = "message";
        data = [];
        if (type === "stream.ready") {
          sawReady = true;
          everLive = true;
          failures = 0;
          handlers.onStatus("live");
          handlers.onReady();
        } else if (type === "stream.resync") {
          handlers.onResync();
        } else if (type !== "stream.closing" && type !== "message" && payload) {
          try {
            handlers.onEvent(type, JSON.parse(payload));
          } catch {
            // A malformed event is skipped; the next resync covers it.
          }
        }
      };

      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          feedWatchdog();
          buffer += value;
          let newline: number;
          while ((newline = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, newline).replace(/\r$/, "");
            buffer = buffer.slice(newline + 1);
            if (line === "")
              dispatch(); // a blank line ends one event
            else if (line.startsWith(":"))
              continue; // heartbeat comment
            else if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
            else if (line.startsWith("retry:")) {
              const ms = Number(line.slice(6).trim());
              if (ms > 0) retryMs = ms;
            }
          }
        }
      } catch {
        // Aborted (watchdog / stop) or the connection broke: reconnect below.
      }
      if (sawReady) return retryMs;
      failures += 1;
      return backoff();
    } finally {
      clearTimeout(watchdog);
      stop.signal.removeEventListener("abort", abortAttempt);
    }
  }

  void (async () => {
    handlers.onStatus("connecting");
    while (!stop.signal.aborted) {
      const wait = await connectOnce();
      if (stop.signal.aborted) return;
      if (wait === null) {
        handlers.onStatus("offline");
        return;
      }
      handlers.onStatus(everLive ? "reconnecting" : "connecting");
      await sleep(wait, stop.signal);
    }
  })();

  return () => stop.abort();
}
