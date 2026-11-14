"use client";

import { ExternalLink, Inbox } from "lucide-react";

import { Button } from "@hacker-house/ui/components/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@hacker-house/ui/components/sheet";
import { cn } from "@hacker-house/ui/lib/utils";

import { LEVELS } from "@/components/profile/types";
import { initials } from "@/lib/initials";
import { skillLabel } from "@/lib/skills";

import type { SuggestionView } from "./types";

const levelLabel = (level: number) => LEVELS.find((l) => l.level === level)?.label ?? "";

/** "Europe/Berlin (UTC+01:00)" → { zone: "Europe/Berlin", offset: "UTC+01:00" }. */
export function splitZone(candidate: string): { zone: string; offset: string } {
  const match = /^(.*) \((UTC[^)]*)\)$/.exec(candidate);
  return match ? { zone: match[1]!, offset: match[2]! } : { zone: candidate, offset: "" };
}

/** What one skill does for the team, in words. */
export function skillEffect(s: SuggestionView["breakdown"]["skills"][number]): string {
  const name = skillLabel(s.skill);
  if (s.teamLevel === 0) return `Fills a gap: no one has ${name}`;
  if (s.candidateLevel > s.teamLevel)
    return `Raises ${name} from ${s.teamLevel} to ${s.candidateLevel}`;
  return `Team already has ${name} at ${s.teamLevel}`;
}

export const fillsGap = (s: SuggestionView) =>
  s.breakdown.skills.some((skill) => skill.teamLevel === 0 && skill.gain > 0);

/**
 * A suggested teammate's details, from the right (opened from the suggestions list): what they
 * add skill by skill (team level → theirs), time overlap, links, and how the score was made.
 */
export function SuggestionSheet({
  suggestion,
  rank,
  onOpenChange,
  onReviewRequest,
}: {
  suggestion: SuggestionView | null;
  rank: number;
  onOpenChange: (open: boolean) => void;
  onReviewRequest: () => void;
}) {
  const p = suggestion?.participant;
  const b = suggestion?.breakdown;
  const zone = b ? splitZone(b.timezone.candidate) : null;
  const adds = b ? b.skills.filter((skill) => skill.gain > 0).length : 0;

  return (
    <Sheet open={suggestion !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="gap-0 data-[side=right]:w-full! data-[side=right]:sm:max-w-md!"
      >
        {suggestion && p && b && zone && (
          <>
            <SheetHeader className="border-b">
              <div className="flex items-center justify-between gap-3 pr-8">
                <SheetDescription>Suggested teammate</SheetDescription>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-xs font-medium",
                    suggestion.hasRequestedYourTeam
                      ? "bg-chart-5/40 text-accent-foreground"
                      : "bg-accent text-accent-foreground",
                  )}
                >
                  {suggestion.hasRequestedYourTeam ? "Asked to join" : `#${rank} match`}
                </span>
              </div>
              <div className="mt-4 flex flex-col items-center text-center">
                <span
                  aria-hidden
                  className="flex size-20 items-center justify-center rounded-full bg-primary text-2xl font-semibold text-primary-foreground ring-4 ring-accent"
                >
                  {initials(p.name)}
                </span>
                <SheetTitle className="mt-3 text-xl">{p.name}</SheetTitle>
                {p.githubUsername && (
                  <a
                    href={`https://github.com/${p.githubUsername}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-0.5 inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
                  >
                    @{p.githubUsername}
                    {!p.githubVerified && (
                      <span className="text-xs font-normal text-muted-foreground">
                        (unverified)
                      </span>
                    )}
                  </a>
                )}
              </div>
              <dl className="mt-5 grid grid-cols-2 text-center">
                <div>
                  <dd className="text-xl font-semibold tabular-nums">
                    {suggestion.score.toFixed(2)}
                  </dd>
                  <dt className="text-xs text-muted-foreground">Match score</dt>
                </div>
                <div>
                  <dd className="text-xl font-semibold tabular-nums">{b.timezone.overlapHours}h</dd>
                  <dt className="text-xs text-muted-foreground">Shared work hours</dt>
                </div>
              </dl>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto px-4 py-5">
              <div className="flex items-baseline gap-2">
                <span className="text-lg font-semibold tabular-nums">
                  {adds}/{b.skills.length}
                </span>
                <span className="text-sm text-muted-foreground">
                  {b.skills.length === 1 ? "skill adds" : "skills add"} to your team
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${b.skills.length ? (adds / b.skills.length) * 100 : 0}%` }}
                />
              </div>

              {b.skills.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">No skills listed.</p>
              ) : (
                <ul className="mt-4 divide-y">
                  {b.skills.map((skill) => (
                    <li key={skill.skill} className="py-3">
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="font-medium">{skillLabel(skill.skill)}</span>
                        <span className="text-xs text-muted-foreground">
                          {skill.candidateLevel}/5 · {levelLabel(skill.candidateLevel)}
                        </span>
                      </div>
                      {/* Team level (dark) and what they add on top (green). */}
                      <div
                        className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-muted"
                        aria-hidden
                      >
                        <div
                          className="h-full bg-foreground/25"
                          style={{
                            width: `${(Math.min(skill.teamLevel, skill.candidateLevel) / 5) * 100}%`,
                          }}
                        />
                        <div
                          className="h-full bg-primary"
                          style={{
                            width: `${(Math.max(0, skill.candidateLevel - skill.teamLevel) / 5) * 100}%`,
                          }}
                        />
                      </div>
                      <p
                        className={cn(
                          "mt-1.5 text-xs",
                          skill.gain > 0 ? "text-primary" : "text-muted-foreground",
                        )}
                      >
                        {skillEffect(skill)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}

              <h3 className="mt-6 border-b pb-2 text-sm font-semibold">Details</h3>
              <dl className="mt-3 grid gap-3 text-sm">
                <Row label="GitHub">
                  {p.githubUsername ? `@${p.githubUsername}` : <Muted>Not set</Muted>}
                </Row>
                <Row label="Portfolio">
                  {p.portfolioUrl ? (
                    <a
                      href={p.portfolioUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                    >
                      Open link
                      <ExternalLink className="size-3" aria-hidden />
                    </a>
                  ) : (
                    <Muted>Not set</Muted>
                  )}
                </Row>
                <Row label="Timezone">
                  {zone.zone}
                  {zone.offset && <Muted> · {zone.offset}</Muted>}
                </Row>
                <Row label="Your team">{b.timezone.team}</Row>
              </dl>
              <p className="mt-5 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                Score {suggestion.score.toFixed(2)} = skill gain {b.skillGain.toFixed(2)} ×
                time-zone factor {b.timezone.factor.toFixed(2)}. Filling a gap counts most; matching
                what your team already has counts nothing; more shared work hours count more.
              </p>
            </div>

            {suggestion.hasRequestedYourTeam && (
              <SheetFooter className="border-t">
                <Button onClick={onReviewRequest} className="h-10 gap-1.5">
                  <Inbox aria-hidden />
                  Review their join request
                </Button>
              </SheetFooter>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium break-all">{children}</dd>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="font-normal text-muted-foreground">{children}</span>;
}
