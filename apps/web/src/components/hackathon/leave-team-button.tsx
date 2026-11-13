"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@hacker-house/ui/components/button";

import { api } from "@/lib/api";

import { ConfirmDialog } from "./confirm-dialog";

/**
 * Leave my team (Flow 3), after a confirmation that says what will happen:
 *   member → just leave · leader with others → leadership passes to the longest-joined member
 *   (R6) · last member → the team is deleted (R7).
 * The server decides under its locks; the text is the outcome for the team as shown.
 */
export function LeaveTeamButton({
  teamId,
  teamName,
  isLeader,
  alone,
  successorName,
}: {
  teamId: string;
  teamName: string;
  isLeader: boolean;
  /** I'm the only member: leaving deletes the team. */
  alone: boolean;
  /** Who would lead after me (earliest-joined other member), if I'm the leader. */
  successorName: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function leave() {
    setPending(true);
    setError(null);
    const result = await api(`/api/teams/${teamId}/leave`, { body: {}, idempotent: true });
    setPending(false);
    if (result.ok || result.code === "NOT_A_MEMBER") {
      // Left (or had already been removed): the page now shows "not in a team".
      setOpen(false);
      router.refresh();
      return;
    }
    setError(result.message);
  }

  const description = alone
    ? `You're the only member, so ${teamName} will be deleted: its invite code stops working and pending requests are closed.`
    : isLeader
      ? `Leadership passes to ${successorName ?? "the member who joined earliest"}, who has been in the team the longest. You can join or create another team afterwards.`
      : `You can join or create another team afterwards. To come back, you'd have to join ${teamName} again.`;

  return (
    <>
      <Button
        variant="ghost"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="h-8 gap-1.5 text-muted-foreground hover:text-destructive"
      >
        <LogOut aria-hidden />
        Leave team
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={alone ? `Leave and delete ${teamName}?` : `Leave ${teamName}?`}
        description={description}
        confirmLabel={alone ? "Leave and delete" : "Leave team"}
        pending={pending}
        error={error}
        onConfirm={leave}
      />
    </>
  );
}
