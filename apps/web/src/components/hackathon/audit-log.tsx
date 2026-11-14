"use client";

import { useState } from "react";

import { Button } from "@hacker-house/ui/components/button";
import { cn } from "@hacker-house/ui/lib/utils";

import { api } from "@/lib/api";

import { describe, when } from "./audit-format";
import type { AuditCategory, AuditEntryView, AuditPage } from "./types";

type Tab = "all" | AuditCategory;
const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "team", label: "Team" },
  { key: "requests", label: "Requests" },
  { key: "invites", label: "Invites" },
];

/**
 * The team's activity log (GET /api/teams/{id}/audit), newest first: a minimal table of
 * Activity · By · When · Type, with category tabs and "Load more". Used by the leader inside
 * "My team" and by admins in a sheet from the board.
 *
 * `initial` is the first page of "All" (null while the parent is still loading it). A new
 * `initial` (a server re-render after a live event) replaces the list when "All" is shown.
 */
export function AuditLog({ teamId, initial }: { teamId: string; initial: AuditPage | null }) {
  const [tab, setTab] = useState<Tab>("all");
  const [page, setPage] = useState<AuditPage | null>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [shown, setShown] = useState(initial);
  if (initial !== shown) {
    setShown(initial);
    if (tab === "all") setPage(initial);
  }

  async function load(next: Tab, cursor?: string) {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (next !== "all") params.set("category", next);
    if (cursor) params.set("cursor", cursor);
    const result = await api<{ entries: AuditEntryView[] }>(
      `/api/teams/${teamId}/audit?${params.toString()}`,
    );
    setLoading(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setPage((current) => ({
      entries:
        cursor && current
          ? [
              ...current.entries,
              ...result.data.entries.filter((e) => !current.entries.some((c) => c.id === e.id)),
            ]
          : result.data.entries,
      nextCursor: result.nextCursor ?? null,
    }));
  }

  function switchTo(next: Tab) {
    if (next === tab) return;
    setTab(next);
    if (next === "all" && initial) {
      setPage(initial);
      setError(null);
    } else {
      setPage(null);
      void load(next);
    }
  }

  const entries = page?.entries ?? [];

  return (
    <div>
      <div role="tablist" aria-label="Activity type" className="flex w-fit rounded-lg bg-muted p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => switchTo(t.key)}
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors",
              tab === t.key
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="@container mt-4" role="table" aria-label="Team activity">
        <div
          role="row"
          className="hidden grid-cols-[minmax(0,1fr)_6.5rem_6.5rem_9.5rem] gap-4 border-b px-3 pb-2 text-xs text-muted-foreground @xl:grid"
        >
          <span role="columnheader">Activity</span>
          <span role="columnheader">By</span>
          <span role="columnheader">When</span>
          <span role="columnheader">Type</span>
        </div>

        {entries.length === 0 ? (
          <p className="px-3 py-10 text-center text-sm text-muted-foreground">
            {loading || page === null ? "Loading…" : error ? "" : "Nothing here yet."}
          </p>
        ) : (
          entries.map((entry) => {
            const row = describe(entry);
            const at = when(entry.createdAt);
            return (
              <div
                key={entry.id}
                role="row"
                className="grid gap-x-4 gap-y-1.5 border-b px-3 py-3.5 last:border-b-0 @xl:grid-cols-[minmax(0,1fr)_6.5rem_6.5rem_9.5rem] @xl:items-center"
              >
                <div role="cell" className="min-w-0">
                  <p className="text-sm font-medium">{row.title}</p>
                  {row.detail && <p className="text-xs text-muted-foreground">{row.detail}</p>}
                </div>
                <p role="cell" className="truncate text-sm text-muted-foreground">
                  <span className="@xl:hidden">By </span>
                  {row.by}
                  <span className="@xl:hidden">
                    {" "}
                    · {at.date}, {at.time}
                  </span>
                </p>
                <p role="cell" className="hidden text-sm leading-tight @xl:block">
                  {at.date}
                  <span className="block text-xs text-muted-foreground">{at.time}</span>
                </p>
                <div role="cell" className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-foreground/80">
                    {row.category.label}
                  </span>
                  <span
                    className={cn(
                      "rounded-md px-2 py-0.5 text-xs font-medium",
                      row.status.className,
                    )}
                  >
                    {row.status.label}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-center text-sm text-destructive">
          {error}
        </p>
      )}
      {page?.nextCursor && (
        <div className="mt-4 flex justify-center">
          <Button
            variant="outline"
            onClick={() => load(tab, page.nextCursor ?? undefined)}
            disabled={loading}
            className="h-9 px-4"
          >
            {loading ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}
