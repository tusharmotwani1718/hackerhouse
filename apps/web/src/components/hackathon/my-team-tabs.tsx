"use client";

import { useState } from "react";

import { cn } from "@hacker-house/ui/lib/utils";

import { api } from "@/lib/api";

import { SuggestionsList } from "./suggestions-list";
import type { SuggestionsView } from "./types";

type Sub = "details" | "suggest";
const FIRST = 20;
const MORE = 50; // the API's maximum

/**
 * The leader's "My team": two sub-tabs, Team details (the server-rendered team, inbox, log)
 * and Suggest teammates. Suggestions are the heaviest read (own 20/min budget), so they're
 * fetched when the leader opens that tab or presses Refresh, not on every page render.
 */
export function MyTeamTabs({
  teamId,
  seatsLeft,
  memberCount,
  children,
}: {
  teamId: string;
  seatsLeft: number;
  memberCount: number;
  children: React.ReactNode;
}) {
  const [sub, setSub] = useState<Sub>("details");
  const [data, setData] = useState<SuggestionsView | null>(null);
  const [limit, setLimit] = useState(FIRST);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null); // memberCount when fetched
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(nextLimit: number) {
    setLoading(true);
    setError(null);
    const result = await api<SuggestionsView>(
      `/api/teams/${teamId}/suggestions?limit=${nextLimit}`,
    );
    setLoading(false);
    if (!result.ok) {
      setError(
        result.code === "TEAM_FULL"
          ? "Your team is full: there are no open seats to suggest people for."
          : result.message,
      );
      return;
    }
    setData(result.data);
    setLimit(nextLimit);
    setFetchedAt(memberCount);
  }

  function open(next: Sub) {
    setSub(next);
    if (next === "suggest" && data === null && !loading && seatsLeft > 0) void load(FIRST);
  }

  function reviewRequest() {
    setSub("details");
    // After the details render again, bring the inbox into view.
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        document.getElementById("join-requests")?.scrollIntoView({ behavior: "smooth" }),
      ),
    );
  }

  const tabs: { key: Sub; label: string }[] = [
    { key: "details", label: "Team details" },
    { key: "suggest", label: "Suggest teammates" },
  ];

  return (
    <div className="grid gap-5">
      <div role="tablist" aria-label="My team" className="flex w-fit rounded-lg bg-muted p-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={sub === tab.key}
            onClick={() => open(tab.key)}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
              sub === tab.key
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Hidden, not unmounted: the inbox and log keep their tab/page state. */}
      <div className={sub === "details" ? "block" : "hidden"}>{children}</div>
      {sub === "details" ? null : seatsLeft === 0 ? (
        <div className="rounded-xl border border-dashed px-6 py-16 text-center">
          <p className="font-medium">Your team is full</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Suggestions are for open seats. If someone leaves, you&apos;ll find people to fill the
            seat here.
          </p>
        </div>
      ) : (
        <SuggestionsList
          data={data}
          loading={loading}
          error={error}
          stale={data !== null && fetchedAt !== memberCount}
          canShowMore={data !== null && limit < MORE && data.suggestions.length === limit}
          onRefresh={() => load(limit)}
          onShowMore={() => load(MORE)}
          onReviewRequest={reviewRequest}
        />
      )}
    </div>
  );
}
