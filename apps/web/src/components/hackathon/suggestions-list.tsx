"use client";

import { ExternalLink, Eye, Inbox, MoreHorizontal, RefreshCw } from "lucide-react";
import { useState } from "react";

import { Button } from "@hacker-house/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@hacker-house/ui/components/dropdown-menu";
import { cn } from "@hacker-house/ui/lib/utils";

import { initials } from "@/lib/initials";

import { fillsGap, skillEffect, splitZone, SuggestionSheet } from "./suggestion-sheet";
import type { SuggestionsView, SuggestionView } from "./types";

type Filter = "all" | "gap" | "asked";

/** "Fills a gap: no one has AI / ML · Raises Backend from 2 to 4": what they add, at a glance. */
function summary(s: SuggestionView): string {
  const adds = s.breakdown.skills.filter((skill) => skill.gain > 0).slice(0, 2);
  if (adds.length === 0) return "Adds no new skill level · good time overlap";
  return adds.map(skillEffect).join(" · ");
}

/**
 * The leader's teammate suggestions (step 8.1), best match first, styled like the request
 * inbox: All / Fills a gap / Asked to join; each row opens the person's details in a sheet.
 */
export function SuggestionsList({
  data,
  loading,
  error,
  stale,
  canShowMore,
  onRefresh,
  onShowMore,
  onReviewRequest,
}: {
  data: SuggestionsView | null;
  loading: boolean;
  error: string | null;
  /** The team changed since these were fetched (someone joined/left). */
  stale: boolean;
  canShowMore: boolean;
  onRefresh: () => void;
  onShowMore: () => void;
  onReviewRequest: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<SuggestionView | null>(null);

  const all = data?.suggestions ?? [];
  const lists: Record<Filter, SuggestionView[]> = {
    all,
    gap: all.filter(fillsGap),
    asked: all.filter((s) => s.hasRequestedYourTeam),
  };
  const tabs: { key: Filter; label: string }[] = [
    { key: "all", label: `Suggested (${lists.all.length})` },
    { key: "gap", label: `Fills a gap (${lists.gap.length})` },
    { key: "asked", label: `Asked to join (${lists.asked.length})` },
  ];
  const shown = lists[filter];
  const rankOf = (s: SuggestionView) => all.indexOf(s) + 1;

  return (
    <section className="rounded-xl bg-card p-5 ring-1 ring-border">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Suggested teammates</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Registered people without a team, ranked by what they add to your skills and how many
            work hours you share.
          </p>
        </div>
        <Button variant="outline" onClick={onRefresh} disabled={loading} className="h-9 gap-1.5">
          <RefreshCw className={cn(loading && "animate-spin")} aria-hidden />
          Refresh
        </Button>
      </div>

      <div
        role="tablist"
        aria-label="Suggestions"
        className="mt-4 flex w-fit max-w-full overflow-x-auto rounded-lg bg-muted p-1"
      >
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={filter === tab.key}
            onClick={() => setFilter(tab.key)}
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors",
              filter === tab.key
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {stale && (
        <p
          role="status"
          className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-accent/60 px-3 py-2 text-sm text-accent-foreground"
        >
          Your team changed since these were suggested.
          <button
            type="button"
            onClick={onRefresh}
            className="font-medium underline underline-offset-4"
          >
            Refresh suggestions
          </button>
        </p>
      )}

      <ul className="mt-4 divide-y rounded-lg border">
        {shown.length === 0 ? (
          <li className="px-4 py-10 text-center text-sm text-muted-foreground">
            {loading
              ? "Finding people who fit your team…"
              : error
                ? ""
                : filter === "asked"
                  ? "None of the suggested people has asked to join yet."
                  : filter === "gap"
                    ? "No suggested person fills a skill your team lacks."
                    : "No one is available right now: everyone registered is already in a team."}
          </li>
        ) : (
          shown.map((s) => {
            const zone = splitZone(s.breakdown.timezone.candidate);
            return (
              <li
                key={s.participant.id}
                className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50"
              >
                <button
                  type="button"
                  onClick={() => setSelected(s)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span
                    aria-hidden
                    className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold"
                  >
                    {initials(s.participant.name)}
                  </span>
                  <span className="w-36 shrink-0 truncate text-sm font-medium">
                    {s.participant.name}
                  </span>
                  <span className="hidden min-w-0 flex-1 truncate text-sm text-muted-foreground sm:block">
                    {summary(s)}
                  </span>
                </button>
                {s.hasRequestedYourTeam && (
                  <span className="hidden shrink-0 rounded-full bg-chart-5/40 px-2 py-0.5 text-xs font-medium text-accent-foreground md:inline">
                    Asked to join
                  </span>
                )}
                <span className="hidden shrink-0 text-xs text-muted-foreground md:inline">
                  {zone.offset}
                </span>
                <span
                  title="Match score"
                  className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground tabular-nums"
                >
                  {s.score.toFixed(2)}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Actions for ${s.participant.name}`}
                      >
                        <MoreHorizontal aria-hidden />
                      </Button>
                    }
                  />
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem onClick={() => setSelected(s)}>
                      <Eye aria-hidden />
                      View details
                    </DropdownMenuItem>
                    {s.hasRequestedYourTeam && (
                      <DropdownMenuItem onClick={onReviewRequest}>
                        <Inbox aria-hidden />
                        Review join request
                      </DropdownMenuItem>
                    )}
                    {s.participant.githubUsername && (
                      <DropdownMenuItem
                        onClick={() =>
                          window.open(
                            `https://github.com/${s.participant.githubUsername}`,
                            "_blank",
                            "noreferrer",
                          )
                        }
                      >
                        <ExternalLink aria-hidden />
                        GitHub profile
                      </DropdownMenuItem>
                    )}
                    {s.participant.portfolioUrl && (
                      <DropdownMenuItem
                        onClick={() =>
                          window.open(s.participant.portfolioUrl!, "_blank", "noreferrer")
                        }
                      >
                        <ExternalLink aria-hidden />
                        Portfolio
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            );
          })
        )}
      </ul>

      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {canShowMore && filter === "all" && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" onClick={onShowMore} disabled={loading} className="h-9">
            {loading ? "Loading…" : "Show more people"}
          </Button>
        </div>
      )}

      <SuggestionSheet
        suggestion={selected}
        rank={selected ? rankOf(selected) : 0}
        onOpenChange={(open) => !open && setSelected(null)}
        onReviewRequest={() => {
          setSelected(null);
          onReviewRequest();
        }}
      />
    </section>
  );
}
