"use client";

import { UserMinus } from "lucide-react";
import { useState } from "react";

import { Button } from "@hacker-house/ui/components/button";

import { ConfirmDialog } from "./confirm-dialog";
import { useLeaderAction } from "./leader-action";

/** Leader: remove a member (Flow 7). Not shown on the leader's own row (they leave instead). */
export function RemoveMemberButton({
  teamId,
  participantId,
  name,
}: {
  teamId: string;
  participantId: string;
  name: string;
}) {
  const { run, pending, error, setError } = useLeaderAction();
  const [open, setOpen] = useState(false);

  async function remove() {
    const result = await run(`/api/teams/${teamId}/members/${participantId}/remove`, {
      body: {},
      idempotent: true,
    });
    if (result.ok || result.code === "NOT_A_MEMBER") setOpen(false);
  }

  return (
    <>
      <Button
        variant="ghost"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="h-8 gap-1.5 text-muted-foreground hover:text-destructive"
        aria-label={`Remove ${name} from the team`}
      >
        <UserMinus aria-hidden />
        Remove
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Remove ${name}?`}
        description={`${name} leaves your team at once and can join another team. Their seat opens up again.`}
        confirmLabel="Remove"
        pending={pending}
        error={error}
        onConfirm={remove}
      />
    </>
  );
}
