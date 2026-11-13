"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { api } from "@/lib/api";

export type Decision = "approve" | "decline";

/** What the leader sees after an approve/decline attempt. */
export type DecisionOutcome = { ok: boolean; message: string };

/**
 * Approve or decline a join request (Flows 2 / 2b), then re-render the page from the server:
 * the members, seats, pending count and inbox all change together. One fresh Idempotency-Key
 * per click.
 */
export function useDecide(onDone?: (outcome: DecisionOutcome) => void) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function decide(requestId: string, decision: Decision, name: string) {
    setBusy(requestId);
    const result = await api(`/api/requests/${requestId}/${decision}`, {
      body: {},
      idempotent: true,
    });
    setBusy(null);
    let outcome: DecisionOutcome;
    if (result.ok) {
      outcome = {
        ok: true,
        message:
          decision === "approve" ? `${name} joined your team.` : `Declined ${name}'s request.`,
      };
    } else {
      switch (result.code) {
        case "TEAM_FULL":
          outcome = {
            ok: false,
            message: "Your team is full, so this request was declined automatically.",
          };
          break;
        case "REQUEST_NOT_PENDING":
          outcome = {
            ok: false,
            message: `${name}'s request was already closed (they may have joined another team).`,
          };
          break;
        case "NOT_LEADER":
          outcome = { ok: false, message: "You're no longer this team's leader." };
          break;
        default:
          outcome = { ok: false, message: result.message };
      }
    }
    onDone?.(outcome);
    // Every outcome above changes (or reveals a change in) what the page should show.
    if (result.ok || result.code !== "NETWORK") router.refresh();
    return outcome;
  }

  return { decide, busy };
}
