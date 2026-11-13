// DEV-ONLY probe for step 6.1: listen on the event bus for a few seconds and return what
// arrived — the only way to observe the bus before /api/stream (6.2) exists. 404 in production
// unless ENABLE_DEV_PROBES is set (test harnesses). Remove once 6.2 + Phase 10 tests cover it.
//
// GET /api/dev/events?hackathonId=…&ms=3000[&channel=probe][&throw=1]
//   channels = user:{me} (+ hackathon:{id}) (+ an extra raw channel, e.g. `probe`).
//   throw=1 also registers a listener that always throws (a failing listener must not stop
//   the others).
import { z } from "zod";

import { requireUser } from "@/server/auth/session";
import { getEventBus } from "@/server/core/bus";
import { AppError } from "@/server/core/errors";
import type { DeliveredEvent } from "@/server/core/events";
import { ok } from "@/server/core/http";
import { route } from "@/server/core/route";
import { isUuid, parseQuery } from "@/server/core/validate";
import { getEnv } from "@/server/env";

const querySchema = z.object({
  hackathonId: z.string().refine(isUuid, { error: "must be a uuid" }).optional(),
  channel: z.string().max(100).optional(),
  ms: z.coerce.number().int().min(100).max(30_000).default(3_000),
  throw: z.enum(["1"]).optional(),
});

export const GET = route(async (req: Request) => {
  if (getEnv().NODE_ENV === "production" && !getEnv().ENABLE_DEV_PROBES) {
    throw new AppError("NOT_FOUND", `No endpoint ${req.method} ${new URL(req.url).pathname}.`);
  }
  const { user } = await requireUser(req);
  const query = parseQuery(req, querySchema);

  const channels = [`user:${user.id}`];
  if (query.hackathonId) channels.push(`hackathon:${query.hackathonId}`);
  if (query.channel) channels.push(query.channel);

  const received: Pick<DeliveredEvent, "channel" | "type" | "data">[] = [];
  const bus = getEventBus();
  const unsubscribers = [
    ...(query.throw
      ? [
          bus.subscribe(channels, () => {
            throw new Error("probe: deliberately failing listener");
          }),
        ]
      : []),
    bus.subscribe(channels, (event) =>
      received.push({ channel: event.channel, type: event.type, data: event.data }),
    ),
  ];
  try {
    await new Promise((resolve) => setTimeout(resolve, query.ms));
  } finally {
    for (const unsubscribe of unsubscribers) unsubscribe();
  }
  return ok({ instancePort: new URL(req.url).port, channels, listenedMs: query.ms, received });
});
