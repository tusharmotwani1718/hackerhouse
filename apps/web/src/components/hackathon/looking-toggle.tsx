"use client";

import { Switch } from "@hacker-house/ui/components/switch";

import { useLeaderAction } from "./leader-action";

/**
 * Leader: show/hide the team on the board ("looking for members", Flow 9a). A full team can be
 * switched off, but not on (no seat to offer); it shows on the board only while looking AND not
 * full.
 */
export function LookingToggle({
  teamId,
  isLooking,
  seatsLeft,
}: {
  teamId: string;
  isLooking: boolean;
  seatsLeft: number;
}) {
  const { run, pending, error } = useLeaderAction();
  const full = seatsLeft === 0;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium" id="looking-label">
          Looking for members
        </p>
        <p className="text-xs text-muted-foreground">
          {full && !isLooking
            ? "Your team is full. Free a seat to show it on the board again."
            : isLooking && full
              ? "On, but the team is full, so it isn't shown on the board."
              : isLooking
                ? "Your team is shown on the board."
                : "Hidden from the board. Invite codes and requests still work."}
        </p>
        {error && (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      <Switch
        aria-labelledby="looking-label"
        checked={isLooking}
        disabled={pending || (full && !isLooking)}
        onCheckedChange={(checked) =>
          run(`/api/teams/${teamId}`, { method: "PATCH", body: { isLooking: checked } })
        }
      />
    </div>
  );
}
