"use client";

import { KeyRound, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@hacker-house/ui/components/button";
import { Label } from "@hacker-house/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@hacker-house/ui/components/select";

import { ConfirmDialog } from "./confirm-dialog";
import { InviteCodeBox } from "./invite-code-box";
import { useLeaderAction } from "./leader-action";

const VALIDITY = [
  { value: "24", label: "1 day" },
  { value: "72", label: "3 days" },
  { value: "168", label: "7 days" },
  { value: "336", label: "14 days" },
  { value: "720", label: "30 days" },
];

/**
 * Leader: the invite code with "New code" (Flow 9b: the old code stops working) and "Revoke"
 * (9c: no code until a new one is made), or "Create invite code" when none is active.
 */
export function InviteCodeManager({
  teamId,
  invite,
}: {
  teamId: string;
  invite: { code: string; expiresAt: string } | null;
}) {
  const regenerate = useLeaderAction();
  const revoke = useLeaderAction();
  const [newOpen, setNewOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [hours, setHours] = useState("168");

  async function makeCode() {
    const result = await regenerate.run(`/api/teams/${teamId}/invite-code`, {
      body: { expiresInHours: Number(hours) },
      idempotent: true,
    });
    if (result.ok) setNewOpen(false);
  }

  async function revokeCode() {
    const result = await revoke.run(`/api/teams/${teamId}/invite-code`, {
      method: "DELETE",
      idempotent: true,
    });
    if (result.ok || result.code === "NO_ACTIVE_CODE") setRevokeOpen(false);
  }

  return (
    <div className="grid gap-2">
      {invite ? (
        <InviteCodeBox code={invite.code} expiresAt={invite.expiresAt} />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed px-4 py-3">
          <p className="text-sm text-muted-foreground">
            No active invite code: nobody can join with a code right now.
          </p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => {
            regenerate.setError(null);
            setNewOpen(true);
          }}
          className="h-8 gap-1.5"
        >
          {invite ? <RefreshCw aria-hidden /> : <KeyRound aria-hidden />}
          {invite ? "New code" : "Create invite code"}
        </Button>
        {invite && (
          <Button
            variant="ghost"
            onClick={() => {
              revoke.setError(null);
              setRevokeOpen(true);
            }}
            className="h-8 gap-1.5 text-destructive hover:text-destructive"
          >
            <Trash2 aria-hidden />
            Revoke
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        title={invite ? "Replace the invite code?" : "Create an invite code?"}
        description={
          invite
            ? "The current code stops working at once. Share the new one with the people you want to invite."
            : "Anyone with the code can join (or ask to join) your team while it's valid."
        }
        confirmLabel={invite ? "Replace code" : "Create code"}
        destructive={Boolean(invite)}
        pending={regenerate.pending}
        error={regenerate.error}
        onConfirm={makeCode}
      >
        <div className="grid gap-2">
          <Label>Valid for</Label>
          <Select
            items={VALIDITY}
            value={hours}
            onValueChange={(next) => {
              if (typeof next === "string") setHours(next);
            }}
          >
            <SelectTrigger className="h-9 w-full" aria-label="Valid for">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VALIDITY.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={revokeOpen}
        onOpenChange={setRevokeOpen}
        title="Revoke the invite code?"
        description="It stops working at once. Nobody can join with a code until you create a new one."
        confirmLabel="Revoke code"
        pending={revoke.pending}
        error={revoke.error}
        onConfirm={revokeCode}
      />
    </div>
  );
}
