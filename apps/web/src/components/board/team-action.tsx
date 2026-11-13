"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@hacker-house/ui/components/button";

import { api } from "@/lib/api";

import { JoinCodeDialog } from "./join-code-dialog";
import type { BoardTeam, BoardViewer } from "./types";

/** After these, what the page shows is out of date: re-render it from the server. */
const STALE = new Set([
  "TEAM_FULL",
  "TEAM_NOT_FOUND",
  "ALREADY_IN_TEAM",
  "USE_JOIN",
  "APPROVAL_REQUIRED",
]);

/**
 * The button on a team card, by who's looking and the team's type:
 *   your team → "Your team" · in another team → "You're in X" · not registered → "Register first"
 *   full → "Full" · already asked → "Requested" · invite-only → "Join with code"
 *   OPEN → "Join" (instant) · APPROVAL → "Request to join" (the leader decides)
 */
export function TeamAction({ team, viewer }: { team: BoardTeam; viewer: BoardViewer }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  // Requested = the server says so (pending list, kept fresh by router.refresh()) OR it was
  // just sent from this button. Derived, not copied into state, so a refresh updates it.
  const [justRequested, setRequested] = useState(false);
  const requested = justRequested || viewer.pendingTeamIds.includes(team.id);
  const [error, setError] = useState<string | null>(null);

  if (viewer.team?.id === team.id) {
    return (
      <span className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-medium text-accent-foreground">
        <Check className="size-4" aria-hidden />
        Your team
      </span>
    );
  }
  if (viewer.team) {
    return <span className="text-sm text-muted-foreground">You&apos;re in {viewer.team.name}</span>;
  }
  if (!viewer.registered) {
    return (
      <Button variant="outline" disabled className="h-9" title="Register for this hackathon first">
        Register first
      </Button>
    );
  }
  if (team.seatsLeft <= 0) {
    return (
      <Button variant="outline" disabled className="h-9">
        Full
      </Button>
    );
  }
  // Before the invite-only check: a code for an APPROVAL team also ends in a pending request.
  if (requested) {
    return (
      <Button variant="outline" disabled className="h-9">
        Requested
      </Button>
    );
  }
  if (team.access === "INVITE_ONLY") return <JoinCodeDialog teamName={team.name} />;

  const isOpen = team.joinPolicy === "OPEN";
  async function act() {
    setPending(true);
    setError(null);
    const result = await api(`/api/teams/${team.id}/${isOpen ? "join" : "requests"}`, {
      body: {},
      idempotent: true,
    });
    if (result.ok) {
      if (isOpen)
        router.refresh(); // you're in: the whole page changes
      else setRequested(true);
      setPending(false);
      return;
    }
    if (result.code === "REQUEST_ALREADY_PENDING") {
      setRequested(true);
    } else {
      setError(result.message);
      if (STALE.has(result.code)) router.refresh();
    }
    setPending(false);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        onClick={act}
        disabled={pending}
        className="h-9 min-w-24 hover:bg-foreground hover:text-background"
      >
        {pending ? (isOpen ? "Joining…" : "Sending…") : isOpen ? "Join" : "Request to join"}
      </Button>
      {error && (
        <p role="alert" className="max-w-56 text-right text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
