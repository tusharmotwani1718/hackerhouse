"use client";

import { Check, MoreHorizontal, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@hacker-house/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@hacker-house/ui/components/dropdown-menu";
import { cn } from "@hacker-house/ui/lib/utils";

import { api } from "@/lib/api";
import { initials } from "@/lib/initials";
import { skillLabel } from "@/lib/skills";

import { RequestSheet } from "./request-sheet";
import { REQUEST_STATUS } from "./request-status";
import { DATE, type InboxRequestView, type RequestStatus } from "./types";
import { useDecide, type DecisionOutcome } from "./use-decide";

type Page = { requests: InboxRequestView[]; totalCount: number; nextCursor: string | null };
const TABS: { status: RequestStatus; label: string }[] = [
  { status: "PENDING", label: "Pending" },
  { status: "APPROVED", label: "Approved" },
  { status: "DECLINED", label: "Declined" },
  { status: "CANCELLED", label: "Cancelled" },
];

/** "@octocat · Frontend 4 · Data 2": who they are at a glance. */
function summary(request: InboxRequestView): string {
  const top = Object.entries(request.requester.skills)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([skill, level]) => `${skillLabel(skill)} ${level}`);
  return [request.requester.githubUsername && `@${request.requester.githubUsername}`, ...top]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The leader's request inbox (APPROVAL teams), inside "My team". Pending first (oldest first,
 * fair order); the other statuses on demand. Each row opens the requester's details in a sheet;
 * Approve / Decline from the row's menu or the sheet.
 */
export function RequestInbox({ teamId, initial }: { teamId: string; initial: Page }) {
  const [status, setStatus] = useState<RequestStatus>("PENDING");
  const [page, setPage] = useState<Page>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<DecisionOutcome | null>(null);
  const [selected, setSelected] = useState<InboxRequestView | null>(null);
  const { decide, busy } = useDecide(setNotice);

  // A new server render (after a decision) brings fresh PENDING data: show it if on Pending.
  const [shown, setShown] = useState(initial);
  if (initial !== shown) {
    setShown(initial);
    if (status === "PENDING") setPage(initial);
  }

  async function load(next: RequestStatus, cursor?: string) {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ status: next });
    if (cursor) params.set("cursor", cursor);
    const result = await api<{ requests: InboxRequestView[]; totalCount: number }>(
      `/api/teams/${teamId}/requests?${params.toString()}`,
    );
    setLoading(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setPage((current) => ({
      requests: cursor
        ? [
            ...current.requests,
            ...result.data.requests.filter((r) => !current.requests.some((c) => c.id === r.id)),
          ]
        : result.data.requests,
      totalCount: result.data.totalCount,
      nextCursor: result.nextCursor ?? null,
    }));
  }

  function switchTo(next: RequestStatus) {
    if (next === status) return;
    setStatus(next);
    setNotice(null);
    if (next === "PENDING") setPage(initial);
    else {
      setPage({ requests: [], totalCount: 0, nextCursor: null });
      void load(next);
    }
  }

  async function act(request: InboxRequestView, decision: "approve" | "decline") {
    const outcome = await decide(request.id, decision, request.requester.name);
    if (outcome.ok || selected?.id === request.id) setSelected(null);
  }

  return (
    <section className="rounded-xl bg-card p-5 ring-1 ring-border">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Join requests</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Open a request to see the person&apos;s skills and details.
          </p>
        </div>
        <div role="tablist" aria-label="Request status" className="flex rounded-lg bg-muted p-1">
          {TABS.map((tab) => (
            <button
              key={tab.status}
              type="button"
              role="tab"
              aria-selected={status === tab.status}
              onClick={() => switchTo(tab.status)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors",
                status === tab.status
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
              {tab.status === "PENDING" && ` (${initial.totalCount})`}
            </button>
          ))}
        </div>
      </div>

      {notice && (
        <p
          role="status"
          className={cn(
            "mt-4 rounded-lg px-3 py-2 text-sm",
            notice.ok
              ? "bg-accent/60 text-accent-foreground"
              : "bg-destructive/10 text-destructive",
          )}
        >
          {notice.message}
        </p>
      )}

      <ul className="mt-4 divide-y rounded-lg border">
        {page.requests.length === 0 ? (
          <li className="px-4 py-10 text-center text-sm text-muted-foreground">
            {loading
              ? "Loading…"
              : status === "PENDING"
                ? "No one is waiting for a decision right now."
                : `No ${REQUEST_STATUS[status].label.toLowerCase()} requests.`}
          </li>
        ) : (
          page.requests.map((request) => (
            <li key={request.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50">
              <button
                type="button"
                onClick={() => setSelected(request)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <span
                  aria-hidden
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold"
                >
                  {initials(request.requester.name)}
                </span>
                <span className="w-36 shrink-0 truncate text-sm font-medium">
                  {request.requester.name}
                </span>
                <span className="hidden min-w-0 flex-1 truncate text-sm text-muted-foreground sm:block">
                  {summary(request)}
                </span>
              </button>
              <span className="shrink-0 text-xs text-muted-foreground">
                {DATE.format(new Date(request.createdAt))}
              </span>
              {request.status === "PENDING" ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={busy === request.id}
                        aria-label={`Actions for ${request.requester.name}`}
                      >
                        <MoreHorizontal aria-hidden />
                      </Button>
                    }
                  />
                  <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuItem onClick={() => act(request, "approve")}>
                      <Check aria-hidden />
                      Approve
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => act(request, "decline")}
                      className="text-destructive focus:text-destructive"
                    >
                      <X aria-hidden />
                      Decline
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
                    REQUEST_STATUS[request.status].className,
                  )}
                >
                  {request.status === "DECLINED" && request.declineReason === "TEAM_FULL"
                    ? "Team full"
                    : REQUEST_STATUS[request.status].label}
                </span>
              )}
            </li>
          ))
        )}
      </ul>

      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {page.nextCursor && (
        <div className="mt-4 flex justify-center">
          <Button
            variant="outline"
            onClick={() => load(status, page.nextCursor ?? undefined)}
            disabled={loading}
            className="h-9"
          >
            {loading ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}

      <RequestSheet
        request={selected}
        onOpenChange={(open) => !open && setSelected(null)}
        onDecide={act}
        busy={busy !== null}
      />
    </section>
  );
}
