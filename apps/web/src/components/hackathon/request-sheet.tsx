"use client";

import { Check, ExternalLink, X } from "lucide-react";

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

import { REQUEST_STATUS } from "./request-status";
import { DATE, type InboxRequestView } from "./types";

const levelLabel = (level: number) => LEVELS.find((l) => l.level === level)?.label ?? "";

/**
 * The requester's details, from the right (opened by clicking a row in the inbox): who they
 * are, their skills as level bars, links, timezone, and Approve / Decline while pending.
 */
export function RequestSheet({
  request,
  onOpenChange,
  onDecide,
  busy,
}: {
  request: InboxRequestView | null;
  onOpenChange: (open: boolean) => void;
  onDecide: (request: InboxRequestView, decision: "approve" | "decline") => void;
  busy: boolean;
}) {
  const r = request?.requester;
  const skills = r
    ? Object.entries(r.skills)
        .filter((entry): entry is [string, number] => typeof entry[1] === "number")
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    : [];
  const status = request ? REQUEST_STATUS[request.status] : null;

  return (
    <Sheet open={request !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
        {request && r && status && (
          <>
            <SheetHeader className="border-b">
              <div className="flex items-center justify-between gap-3 pr-8">
                <SheetDescription>Join request</SheetDescription>
                <span
                  className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", status.className)}
                >
                  {status.label}
                </span>
              </div>
              <div className="mt-4 flex flex-col items-center text-center">
                <span
                  aria-hidden
                  className="flex size-20 items-center justify-center rounded-full bg-primary text-2xl font-semibold text-primary-foreground ring-4 ring-accent"
                >
                  {initials(r.name)}
                </span>
                <SheetTitle className="mt-3 text-xl">{r.name}</SheetTitle>
                {r.githubUsername && (
                  <a
                    href={`https://github.com/${r.githubUsername}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-0.5 inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
                  >
                    @{r.githubUsername}
                    <span className="text-xs font-normal text-muted-foreground">(unverified)</span>
                  </a>
                )}
              </div>
              <dl className="mt-5 grid grid-cols-2 text-center">
                <div>
                  <dd className="text-xl font-semibold tabular-nums">{skills.length}</dd>
                  <dt className="text-xs text-muted-foreground">
                    {skills.length === 1 ? "Skill" : "Skills"}
                  </dt>
                </div>
                <div>
                  <dd className="text-xl font-semibold tabular-nums">
                    {skills[0] ? `${skills[0][1]}/5` : "–"}
                  </dd>
                  <dt className="text-xs text-muted-foreground">
                    Top level{skills[0] ? ` · ${skillLabel(skills[0][0])}` : ""}
                  </dt>
                </div>
              </dl>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto px-4 py-5">
              <h3 className="text-sm font-semibold">Skills</h3>
              {skills.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">No skills listed.</p>
              ) : (
                <ul className="mt-3 grid gap-3">
                  {skills.map(([skill, level]) => (
                    <li key={skill}>
                      <div className="flex items-baseline justify-between text-sm">
                        <span className="font-medium">{skillLabel(skill)}</span>
                        <span className="text-xs text-muted-foreground">
                          {level}/5 · {levelLabel(level)}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${(level / 5) * 100}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <h3 className="mt-7 border-b pb-2 text-sm font-semibold">Details</h3>
              <dl className="mt-3 grid gap-3 text-sm">
                <Row label="GitHub">
                  {r.githubUsername ? `@${r.githubUsername}` : <Muted>Not set</Muted>}
                </Row>
                <Row label="Portfolio">
                  {r.portfolioUrl ? (
                    <a
                      href={r.portfolioUrl}
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
                <Row label="Timezone">{r.timezone}</Row>
                <Row label="Requested">{DATE.format(new Date(request.createdAt))}</Row>
                {request.decidedAt && (
                  <Row label="Closed">{DATE.format(new Date(request.decidedAt))}</Row>
                )}
              </dl>
            </div>

            {request.status === "PENDING" && (
              <SheetFooter className="flex-row border-t">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => onDecide(request, "decline")}
                  className="h-10 flex-1 gap-1.5 text-destructive hover:text-destructive"
                >
                  <X aria-hidden />
                  Decline
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => onDecide(request, "approve")}
                  className="h-10 flex-1 gap-1.5"
                >
                  <Check aria-hidden />
                  {busy ? "Saving…" : "Approve"}
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
