"use client";

import { KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@hacker-house/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@hacker-house/ui/components/dialog";
import { Input } from "@hacker-house/ui/components/input";
import { Label } from "@hacker-house/ui/components/label";

import { api } from "@/lib/api";

/**
 * Invite-only teams: enter the code the team shared (POST /api/invites/redeem). The code itself
 * decides the team and the outcome: an OPEN team → joined; an APPROVAL team → request sent.
 */
export function JoinCodeDialog({ teamName }: { teamName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code") ?? "").trim();
    setPending(true);
    setError(null);
    const result = await api(`/api/invites/redeem`, { body: { code }, idempotent: true });
    if (result.ok) {
      setOpen(false);
      router.refresh(); // joined, or the request now shows as "Requested"
      return;
    }
    setError(result.message);
    setPending(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setError(null);
          setPending(false);
        }
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline" className="h-9 gap-1.5">
            <KeyRound aria-hidden />
            Join with code
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Join {teamName}</DialogTitle>
          <DialogDescription>
            This team is invite-only. Enter the invite code its members shared with you.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="invite-code">Invite code</Label>
            <Input
              id="invite-code"
              name="code"
              required
              maxLength={64}
              autoComplete="off"
              placeholder="ABCD-EFGH-JKLM"
              className="h-10 font-mono tracking-wider uppercase"
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Checking…" : "Use code"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
