// GET /api/stream?hackathonId={uuid} — the live event stream, one per browser tab (step 6.2,
// 05 §5). Channels are decided HERE, never by the client: `user:{me}` always, plus
// `hackathon:{id}` when given (all logged-in users may follow any hackathon, like the reads).
// Every check runs BEFORE the stream opens, so failures are normal JSON errors:
// 401 not signed in · 400 bad hackathonId · 404 HACKATHON_NOT_FOUND · 429 TOO_MANY_STREAMS.
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
import { getStreamSlots } from "@/server/realtime/stream-slots";

const querySchema = z.object({
  hackathonId: z.string().refine(isUuid, { error: "must be a uuid" }).optional(),
});

/** Reconnect delay sent as `retry:` (D2): random, so a restart's reconnects are spread out. */
const RETRY_MIN_MS = 2_000;
const RETRY_MAX_MS = 10_000;

const randomBetween = (min: number, max: number) => Math.round(min + Math.random() * (max - min));

export const GET = route(async (req: Request) => {
  // Own limits: the concurrent cap below (+ 20 connects/min in step 7.4), not the read budget —
  // a stream is one long request, and reconnect storms are what 7.4 limits.
  const { user } = await requireUser(req, { limit: "none" });
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

  // The slot is taken LAST: a request that fails any check above never holds one (D8).
  const env = getEnv();
  const slots = getStreamSlots();
  const connId = crypto.randomUUID();
  if (!(await slots.acquire(user.id, connId))) {
    throw new AppError(
      "TOO_MANY_STREAMS",
      `You already have ${env.SSE_MAX_STREAMS_PER_USER} live connections open (one per tab). Close a tab and try again.`,
    );
  }

  const stream = openEventStream({
    bus: getEventBus(),
    channels,
    signal: req.signal,
    heartbeatMs: env.SSE_HEARTBEAT_MS,
    lifetimeMs: randomBetween(env.SSE_MAX_LIFETIME_MS, (env.SSE_MAX_LIFETIME_MS * 4) / 3),
    retryMs: randomBetween(RETRY_MIN_MS, RETRY_MAX_MS),
    bufferBytes: env.SSE_BUFFER_BYTES,
    onHeartbeat: () => slots.refresh(user.id, connId),
    onClose: (summary) => {
      slots.release(user.id, connId);
      logger.info("stream closed", { connId, ...summary, openStreams: slots.openCount });
    },
  });
  logger.info("stream opened", { connId, channels, openStreams: slots.openCount });

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
