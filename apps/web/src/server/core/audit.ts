import "server-only";

import type { AuditAction, Prisma } from "@hacker-house/db";

import { getRequestContext } from "./context";
import type { Tx } from "./tx";

/** One audit row (02 §3.8). Ids are plain values: audit rows have no FKs and outlive their subjects. */
export type AuditEntry = {
  action: AuditAction;
  /** NULL only for actions not tied to a hackathon (admin CLI). */
  hackathonId: string | null;
  teamId?: string | null;
  /** The signed-in user who caused it. NULL only for the admin CLI. */
  actorUserId: string | null;
  /** The user it happened to, when that's someone else (removed member, new leader, ...). */
  targetUserId?: string | null;
  /** Small, non-secret facts (never invite codes or passwords): `{ fromLeader, toLeader }`. */
  metadata?: Prisma.InputJsonObject;
};

/**
 * Append audit rows inside the flow's own transaction (03 §0.2 step 6): they commit or roll
 * back together with the change they describe. `request_id` comes from the request context,
 * so a row can be matched with the request's log lines.
 */
export async function writeAudit(tx: Tx, entries: readonly AuditEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const requestId = getRequestContext()?.requestId ?? null;
  await tx.auditLog.createMany({
    data: entries.map((entry) => ({
      action: entry.action,
      hackathonId: entry.hackathonId,
      teamId: entry.teamId ?? null,
      actorUserId: entry.actorUserId,
      targetUserId: entry.targetUserId ?? null,
      metadata: entry.metadata ?? {},
      requestId,
    })),
  });
}
