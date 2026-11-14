import { CalendarDays, Crown, Lock, Users } from "lucide-react";

import { cn } from "@hacker-house/ui/lib/utils";

import { skillLabel } from "@/lib/skills";

import { TeamAction } from "./team-action";
import { TeamActivityButton } from "./team-activity-button";
import type { BoardTeam, BoardViewer } from "./types";

// Fixed format and time zone: the server and the browser render the same text (no mismatch).
const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

// Stronger skill → stronger colour (theme greens).
const LEVEL_DOT = ["", "bg-chart-5", "bg-chart-4", "bg-chart-3", "bg-chart-2", "bg-primary"];

/** One team on the board: name + leader, seats, type, skills, description, and the action. */
export function TeamRow({ team, viewer }: { team: BoardTeam; viewer: BoardViewer }) {
  const skills = Object.entries(team.skillProfile)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const mine = viewer.team?.id === team.id;

  return (
    <article
      className={cn(
        "rounded-xl bg-card p-5 ring-1 transition hover:shadow-md",
        mine ? "ring-primary/50" : "ring-border hover:ring-foreground/20",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="text-lg font-semibold tracking-tight">{team.name}</h3>
            <span className="hidden h-4 w-px bg-border sm:block" aria-hidden />
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Crown className="size-3.5" aria-hidden />
              Led by {team.leader.name}
            </span>
          </div>
          <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
            <Users className="size-3.5" aria-hidden />
            {team.memberCount} of {team.maxSize} members
            <span aria-hidden>·</span>
            <span className={cn(team.seatsLeft > 0 && "font-medium text-primary")}>
              {team.seatsLeft === 0
                ? "full"
                : `${team.seatsLeft} seat${team.seatsLeft === 1 ? "" : "s"} left`}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="rounded-full border px-2.5 py-1 text-xs font-medium">
            {team.joinPolicy === "OPEN" ? "Open" : "Approval"}
          </span>
          {team.access === "INVITE_ONLY" && (
            <span className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium">
              <Lock className="size-3" aria-hidden />
              Invite only
            </span>
          )}
          {viewer.isAdmin && <TeamActivityButton teamId={team.id} teamName={team.name} />}
          <TeamAction team={team} viewer={viewer} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-muted/60 px-3 py-2">
        <span className="text-sm text-muted-foreground">Skills:</span>
        {skills.length === 0 ? (
          <span className="text-sm text-muted-foreground">none listed</span>
        ) : (
          skills.map(([skill, level]) => (
            <span
              key={skill}
              className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs"
            >
              <span className={cn("size-2 rounded-full", LEVEL_DOT[level])} aria-hidden />
              {skillLabel(skill)}
              <span className="text-muted-foreground">{level}/5</span>
            </span>
          ))
        )}
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarDays className="size-3.5" aria-hidden />
          {DATE.format(new Date(team.createdAt))}
        </span>
      </div>

      <div className="mt-3 rounded-lg border p-3">
        <p className="text-xs font-medium">Description</p>
        <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">
          {team.description.trim() || "No description yet."}
        </p>
      </div>
    </article>
  );
}
