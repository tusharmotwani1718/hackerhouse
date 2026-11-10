// DEV-ONLY probe for step 0.4: exercises server/core through real HTTP calls.
// Returns 404 in production. Uses temporary tables only (dropped at transaction end) — no schema.
// Requests: apps/web/requests/probe.http. Remove once Phase 10 tests cover the same ground.
import { z } from "zod";

import { getRequestContext } from "@/server/core/context";
import { AppError } from "@/server/core/errors";
import { ok } from "@/server/core/http";
import { logger } from "@/server/core/logger";
import { route } from "@/server/core/route";
import { runReadTx, runTx } from "@/server/core/tx";
import { parseJson, parseParams } from "@/server/core/validate";
import { getDb } from "@/server/db";
import { getEnv } from "@/server/env";

const CASES = [
  "ok",
  "validation",
  "app-error",
  "crash",
  "unique",
  "unique-mapped",
  "check",
  "deferred-fk",
  "lock-timeout",
  "events",
  "events-rollback",
  "snapshot",
  "snapshot-write",
] as const;

const paramsSchema = z.object({ case: z.enum(CASES) });
const PROBE_LOCK_KEY = 0x70726f62; // "prob" — advisory lock key used only by this probe

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function uniqueViolation(mapped: boolean) {
  return runTx(
    async (tx) => {
      await tx.$executeRawUnsafe(
        `CREATE TEMP TABLE probe_names (name text CONSTRAINT probe_names_name_key UNIQUE) ON COMMIT DROP`,
      );
      await tx.$executeRawUnsafe(`INSERT INTO probe_names VALUES ('alpha')`);
      await tx.$executeRawUnsafe(`INSERT INTO probe_names VALUES ('alpha')`);
      return { value: "unreachable" };
    },
    mapped
      ? {
          constraintErrors: {
            probe_names_name_key: {
              code: "CONFLICT",
              message: "Probe: that name is already taken.",
            },
          },
        }
      : {},
  );
}

async function runCase(name: (typeof CASES)[number], req: Request): Promise<Response> {
  switch (name) {
    case "ok":
      return ok({ hello: "world", requestId: getRequestContext()?.requestId });

    case "validation": {
      const body = await parseJson(
        req,
        z.object({ name: z.string().trim().min(2).max(20), size: z.number().int().min(1).max(10) }),
      );
      return ok(body, { status: 201 });
    }

    case "app-error":
      throw new AppError("FORBIDDEN", "Probe: only the team leader can do that.");

    case "crash":
      throw new Error("probe crash — internal detail: SELECT secret FROM users WHERE id = 42");

    case "unique":
      return ok(await uniqueViolation(false));

    case "unique-mapped":
      return ok(await uniqueViolation(true));

    case "check":
      return ok(
        await runTx(async (tx) => {
          await tx.$executeRawUnsafe(
            `CREATE TEMP TABLE probe_counts (n int CONSTRAINT probe_counts_n_check CHECK (n BETWEEN 1 AND 10)) ON COMMIT DROP`,
          );
          await tx.$executeRawUnsafe(`INSERT INTO probe_counts VALUES (11)`);
          return { value: "unreachable" };
        }),
      );

    case "deferred-fk":
      return ok(
        await runTx(async (tx) => {
          await tx.$executeRawUnsafe(
            `CREATE TEMP TABLE probe_parent (id int PRIMARY KEY) ON COMMIT DROP`,
          );
          await tx.$executeRawUnsafe(
            `CREATE TEMP TABLE probe_child (parent_id int CONSTRAINT probe_child_parent_fkey
               REFERENCES probe_parent (id) DEFERRABLE INITIALLY DEFERRED) ON COMMIT DROP`,
          );
          await tx.$executeRawUnsafe(`INSERT INTO probe_child VALUES (999)`); // no parent: fails at COMMIT
          logger.info("probe: child inserted, FK not checked yet (deferred to COMMIT)");
          return { value: "unreachable" };
        }),
      );

    case "lock-timeout": {
      const holdMs = getEnv().DATABASE_LOCK_TIMEOUT_MS + 2_000;
      // A second transaction holds the lock longer than lock_timeout.
      let markHeld!: () => void;
      const held = new Promise<void>((resolve) => (markHeld = resolve));
      const holder = getDb()
        .$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT 1 AS ok FROM pg_advisory_xact_lock(${PROBE_LOCK_KEY})`;
            markHeld();
            await sleep(holdMs);
          },
          { timeout: holdMs + 5_000 },
        )
        .catch((error: unknown) =>
          logger.warn("probe lock holder ended with error", { err: error }),
        );
      await held;
      const startedAt = performance.now();
      try {
        await runTx(async (tx) => {
          await tx.$queryRaw`SELECT 1 AS ok FROM pg_advisory_xact_lock(${PROBE_LOCK_KEY})`;
          return { value: "unreachable" };
        });
        return ok("unreachable");
      } finally {
        logger.info("probe: waiter finished", {
          waitedMs: Math.round(performance.now() - startedAt),
        });
        void holder;
      }
    }

    case "events":
      return ok(
        await runTx(async (tx) => {
          const [row] = await tx.$queryRaw<{ now: Date }[]>`SELECT now() AS now`;
          logger.info("probe: inside transaction, before COMMIT");
          return {
            value: { committedAt: row!.now },
            events: [{ channel: "probe", type: "probe.committed", payload: { at: row!.now } }],
          };
        }),
      );

    case "events-rollback":
      return ok(
        await runTx(async () => {
          const events = [{ channel: "probe", type: "probe.never", payload: {} }];
          logger.info("probe: produced an event, now failing → must NOT be published", {
            pending: events.length,
          });
          throw new AppError("CONFLICT", "Probe: business rule failed after preparing an event.");
        }),
      );

    case "snapshot":
      return ok(
        await runReadTx(async (tx) => {
          const [row] = await tx.$queryRaw<{ isolation: string; readOnly: string }[]>`
            SELECT current_setting('transaction_isolation') AS isolation,
                   current_setting('transaction_read_only') AS "readOnly"`;
          return row;
        }),
      );

    case "snapshot-write":
      return ok(
        await runReadTx(async (tx) => {
          await tx.$executeRawUnsafe(`CREATE TEMP TABLE probe_write (x int)`);
          return "unreachable";
        }),
      );
  }
}

const handler = route(async (req: Request, ctx: RouteContext<"/api/dev/probe/[case]">) => {
  if (getEnv().NODE_ENV === "production") {
    throw new AppError("NOT_FOUND", `No endpoint ${req.method} ${new URL(req.url).pathname}.`);
  }
  const { case: name } = await parseParams(ctx.params, paramsSchema);
  return runCase(name, req);
});

export const GET = handler;
export const POST = handler;
