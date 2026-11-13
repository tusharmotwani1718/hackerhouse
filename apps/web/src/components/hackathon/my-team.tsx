import { Crown, ExternalLink, Lock, Users } from "lucide-react";

import { cn } from "@hacker-house/ui/lib/utils";

import { initials } from "@/lib/initials";
import { skillLabel } from "@/lib/skills";

import { InviteCodeBox } from "./invite-code-box";
import { RequestInbox } from "./request-inbox";
import { DATE, type MyTeamView } from "./types";

const LEVEL_DOT = ["", "bg-chart-5", "bg-chart-4", "bg-chart-3", "bg-chart-2", "bg-primary"];

/**
 * "My team" tab content: the team, its invite code (members only), the join-request inbox
 * (leaders of APPROVAL teams), and its members.
 */
export function MyTeam({ team }: { team: MyTeamView }) {
  return (
    <div className="grid gap-5">
      <section className="rounded-xl bg-card p-5 ring-1 ring-border">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight">{team.name}</h2>
              {team.isLeader && (
                <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
                  <Crown className="size-3" aria-hidden />
                  You lead this team
                </span>
              )}
            </div>
            <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
              <Users className="size-3.5" aria-hidden />
              {team.memberCount} of {team.maxSize} members
              <span aria-hidden>·</span>
              {team.seatsLeft === 0
                ? "full"
                : `${team.seatsLeft} seat${team.seatsLeft === 1 ? "" : "s"} left`}
              <span aria-hidden>·</span>
              {team.listed ? "shown on the board" : "not shown on the board"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full border px-2.5 py-1 text-xs font-medium">
              {team.joinPolicy === "OPEN" ? "Open" : "Approval"}
            </span>
            {team.access === "INVITE_ONLY" && (
              <span className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium">
                <Lock className="size-3" aria-hidden />
                Invite only
              </span>
            )}
          </div>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          {team.description.trim() || "No description yet."}
        </p>
        <div className="mt-4">
          {team.invite ? (
            <InviteCodeBox code={team.invite.code} expiresAt={team.invite.expiresAt} />
          ) : (
            <p className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
              No active invite code
              {team.isLeader
                ? ": you can create a new one from the team settings (coming soon)."
                : "."}
            </p>
          )}
        </div>
      </section>

      {team.inbox && <RequestInbox teamId={team.id} initial={team.inbox} />}

      <section className="rounded-xl bg-card p-5 ring-1 ring-border">
        <h2 className="font-semibold">Members</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          In the order they joined: if the leader leaves, the next person leads.
        </p>
        <ul className="mt-4 divide-y">
          {team.members.map((member) => {
            const skills = Object.entries(member.skills)
              .filter((entry): entry is [string, number] => typeof entry[1] === "number")
              .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
            return (
              <li key={member.participantId} className="flex flex-wrap items-start gap-4 py-4">
                <span
                  aria-hidden
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                    member.isLeader
                      ? "bg-primary text-primary-foreground"
                      : "bg-accent text-accent-foreground",
                  )}
                >
                  {initials(member.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {member.name}
                    {member.isLeader && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                        <Crown className="size-3" aria-hidden />
                        Leader
                      </span>
                    )}
                  </p>
                  <p className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
                    {member.githubUsername && <span>@{member.githubUsername}</span>}
                    {member.portfolioUrl && (
                      <a
                        href={member.portfolioUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                      >
                        Portfolio
                        <ExternalLink className="size-3" aria-hidden />
                      </a>
                    )}
                    <span>Joined {DATE.format(new Date(member.joinedAt))}</span>
                  </p>
                  {skills.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {skills.map(([skill, level]) => (
                        <span
                          key={skill}
                          className="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs"
                        >
                          <span
                            className={cn("size-2 rounded-full", LEVEL_DOT[level])}
                            aria-hidden
                          />
                          {skillLabel(skill)}
                          <span className="text-muted-foreground">{level}/5</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
