// GET /api/stream?hackathonId={uuid} — the live event stream, one per browser tab (step 6.2,
// 05 §5). Channels are decided HERE, never by the client: `user:{me}` always, plus
// `hackathon:{id}` when given (all logged-in users may follow any hackathon, like the reads).
// Every check runs BEFORE the stream opens, so failures are normal JSON errors:
// 401 not signed in · 429 RATE_LIMITED (20 connects/min, 7.4) · 400 bad hackathonId ·
// 404 HACKATHON_NOT_FOUND. No cap on concurrent streams per user in v1 (removed for simplicity).
// Wire format and lifecycle: src/server/realtime/sse-stream.ts.
import { z } from "zod";

import { requireUser } from "@/server/auth/session";
import { getEventBus } from "@/server/core/bus";
import { AppError } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { route } from "@/server/core/route";
import { isUuid, parseQuery } from "@/server/core/validate";
import { getDb } from "@/server/db";
import { getEnv } from "@/server/env";
import { openEventStream } from "@/server/realtime/sse-stream";

const querySchema = z.object({
  hackathonId: z.string().refine(isUuid, { error: "must be a uuid" }).optional(),
});

/** Reconnect delay sent as `retry:` (D2): random, so a restart's reconnects are spread out. */
const RETRY_MIN_MS = 2_000;
const RETRY_MAX_MS = 10_000;

const randomBetween = (min: number, max: number) => Math.round(min + Math.random() * (max - min));

/** Open streams on THIS instance, for the open/close log lines (a leak shows as a count that
 * never returns to 0). */
let openStreams = 0;

export const GET = route(async (req: Request) => {
  // Connect budget (stream.connect.user, 20/min): reconnect storms. Not the read budget — a
  // stream is one long request.
  const { user } = await requireUser(req, { limit: "stream" });
  const { hackathonId } = parseQuery(req, querySchema);

  const channels = [`user:${user.id}`];
  if (hackathonId) {
    const hackathon = await getDb().hackathon.findUnique({
      where: { id: hackathonId },
      select: { id: true },
    });
    if (!hackathon) throw new AppError("HACKATHON_NOT_FOUND", "Hackathon not found.");
    channels.push(`hackathon:${hackathon.id}`);
  }

  const env = getEnv();
  const connId = crypto.randomUUID();

  const stream = openEventStream({
    bus: getEventBus(),
    channels,
    signal: req.signal,
    heartbeatMs: env.SSE_HEARTBEAT_MS,
    lifetimeMs: randomBetween(env.SSE_MAX_LIFETIME_MS, (env.SSE_MAX_LIFETIME_MS * 4) / 3),
    retryMs: randomBetween(RETRY_MIN_MS, RETRY_MAX_MS),
    bufferBytes: env.SSE_BUFFER_BYTES,
    onClose: (summary) => {
      openStreams -= 1;
      logger.info("stream closed", { connId, ...summary, openStreams });
    },
  });
  openStreams += 1;
  logger.info("stream opened", { connId, channels, openStreams });

  // Headers from spike S5 (08): no buffering by Next, nginx (X-Accel-Buffering) or any proxy
  // that would transform/compress (no-transform). The access log line is written now, at open.
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
});
