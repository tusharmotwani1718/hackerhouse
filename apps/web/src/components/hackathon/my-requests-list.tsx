"use client";

import { Lock, Users } from "lucide-react";
import { useState } from "react";

import { Button } from "@hacker-house/ui/components/button";
import { cn } from "@hacker-house/ui/lib/utils";

import { api } from "@/lib/api";

import { REQUEST_STATUS } from "./request-status";
import { DATE, type MyRequestView } from "./types";

/** What happened, in words (decline reason; cancelled = you joined/created another team). */
function outcome(request: MyRequestView): string {
  switch (request.status) {
    case "PENDING":
      return "Waiting for the team leader to decide.";
    case "APPROVED":
      return "Approved: you joined this team.";
    case "DECLINED":
      return request.declineReason === "TEAM_FULL"
        ? "The team filled up before your request was approved."
        : "The leader declined this request.";
    case "CANCELLED":
      return "Closed automatically: you joined or created another team.";
  }
}

/** "My requests" tab: every join request in this hackathon, newest first, with Load more. */
export function MyRequestsList({
  slug,
  initial,
}: {
  slug: string;
  initial: { requests: MyRequestView[]; nextCursor: string | null };
}) {
  const [requests, setRequests] = useState(initial.requests);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A new server render (e.g. after router.refresh()) starts the list over.
  const [shown, setShown] = useState(initial);
  if (initial !== shown) {
    setShown(initial);
    setRequests(initial.requests);
    setCursor(initial.nextCursor);
  }

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    setError(null);
    const result = await api<{ requests: MyRequestView[] }>(
      `/api/hackathons/${slug}/me/requests?cursor=${encodeURIComponent(cursor)}`,
    );
    if (result.ok) {
      setRequests((current) => {
        const seen = new Set(current.map((request) => request.id));
        return [...current, ...result.data.requests.filter((request) => !seen.has(request.id))];
      });
      setCursor(result.nextCursor ?? null);
    } else {
      setError(result.message);
    }
    setLoading(false);
  }

  if (requests.length === 0) {
    return (
      <div className="rounded-xl border border-dashed px-6 py-16 text-center">
        <p className="font-medium">No requests yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          When you ask to join a team that needs approval, it shows up here.
        </p>
      </div>
    );
  }

  return (
    <section aria-label="My join requests">
      <ul className="grid gap-3">
        {requests.map((request) => {
          const status = REQUEST_STATUS[request.status];
          return (
            <li
              key={request.id}
              className="flex flex-wrap items-start justify-between gap-4 rounded-xl bg-card p-4 ring-1 ring-border"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {request.team.name}
                  {request.team.access === "INVITE_ONLY" && (
                    <Lock className="size-3.5 text-muted-foreground" aria-label="Invite only" />
                  )}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{outcome(request)}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Users className="size-3" aria-hidden />
                    {request.team.memberCount} of {request.team.maxSize} members
                  </span>
                  <span>Sent {DATE.format(new Date(request.createdAt))}</span>
                  {request.decidedAt && (
                    <span>Closed {DATE.format(new Date(request.decidedAt))}</span>
                  )}
                </p>
              </div>
              <span
                className={cn("rounded-full px-2.5 py-1 text-xs font-medium", status.className)}
              >
                {status.label}
              </span>
            </li>
          );
        })}
      </ul>
      {cursor && (
        <div className="mt-6 flex flex-col items-center gap-2">
          <Button variant="outline" onClick={loadMore} disabled={loading} className="h-10 px-5">
            {loading ? "Loading…" : "Load more"}
          </Button>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
