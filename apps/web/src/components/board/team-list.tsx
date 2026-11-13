"use client";

import { useState } from "react";

import { Button } from "@hacker-house/ui/components/button";

import { api } from "@/lib/api";

import { TeamRow } from "./team-row";
import { filtersToSearch, type BoardFilters, type BoardTeam, type BoardViewer } from "./types";

type Props = {
  slug: string;
  filters: BoardFilters;
  viewer: BoardViewer;
  initial: { teams: BoardTeam[]; totalCount: number; nextCursor: string | null };
};

/**
 * The teams on the right. The first page comes from the server render (for the current
 * filters); "Load more" fetches the next pages from the API with the same filters + cursor.
 * When the server renders again (new filters, or after joining), the list starts over.
 */
export function TeamList({ slug, filters, viewer, initial }: Props) {
  const [teams, setTeams] = useState(initial.teams);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A new server render (other filters, or after joining) starts the list over. Done during
  // render by comparing with the previous props (React's "reset state on prop change").
  const [shown, setShown] = useState(initial);
  if (initial !== shown) {
    setShown(initial);
    setTeams(initial.teams);
    setCursor(initial.nextCursor);
    setError(null);
  }

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    setError(null);
    const params = filtersToSearch(filters);
    params.delete("show");
    params.set("cursor", cursor);
    const endpoint = filters.show === "all" ? "teams" : "board";
    const result = await api<{ teams: BoardTeam[] }>(
      `/api/hackathons/${slug}/${endpoint}?${params.toString()}`,
    );
    if (result.ok) {
      setTeams((current) => {
        const seen = new Set(current.map((team) => team.id));
        return [...current, ...result.data.teams.filter((team) => !seen.has(team.id))];
      });
      setCursor(result.nextCursor ?? null);
    } else {
      setError(result.message);
    }
    setLoading(false);
  }

  const filtered = Boolean(filters.q || filters.policy || filters.access);

  return (
    <section aria-label="Teams" className="min-w-0">
      <p className="mb-3 text-sm text-muted-foreground">
        <span className="font-semibold text-foreground tabular-nums">{initial.totalCount}</span>{" "}
        {initial.totalCount === 1 ? "team" : "teams"}
        {filters.show === "looking" ? " looking for members" : " in total"}
        {filtered && " (filtered)"}
      </p>

      {teams.length === 0 ? (
        <div className="rounded-xl border border-dashed px-6 py-16 text-center">
          <p className="font-medium">No teams here</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {filtered
              ? "No team matches these filters. Try clearing some."
              : filters.show === "looking"
                ? "No team is looking for members right now."
                : "No team has been created yet."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {teams.map((team) => (
            <TeamRow key={team.id} team={team} viewer={viewer} />
          ))}
        </div>
      )}

      {cursor && (
        <div className="mt-6 flex flex-col items-center gap-2">
          <Button variant="outline" onClick={loadMore} disabled={loading} className="h-10 px-5">
            {loading ? "Loading…" : "Load more teams"}
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
