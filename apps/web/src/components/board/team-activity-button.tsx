"use client";

import { History } from "lucide-react";
import { useState } from "react";

import { Button } from "@hacker-house/ui/components/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@hacker-house/ui/components/sheet";

import { AuditLog } from "@/components/hackathon/audit-log";
import type { AuditEntryView, AuditPage } from "@/components/hackathon/types";
import { api } from "@/lib/api";

/**
 * Admins only (on every board card): opens the team's activity log in a sheet from the right.
 * The first page is fetched on each open, so it's always current.
 */
export function TeamActivityButton({ teamId, teamName }: { teamId: string; teamName: string }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<AuditPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function show() {
    setOpen(true);
    setPage(null);
    setError(null);
    const result = await api<{ entries: AuditEntryView[] }>(`/api/teams/${teamId}/audit`);
    if (result.ok) setPage({ entries: result.data.entries, nextCursor: result.nextCursor ?? null });
    else setError(result.message);
  }

  return (
    <>
      <Button variant="outline" onClick={show} className="h-9">
        <History aria-hidden />
        Activity
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full gap-0 data-[side=right]:sm:max-w-2xl!">
          <SheetHeader className="border-b">
            <SheetDescription>Activity log · admin view</SheetDescription>
            <SheetTitle className="text-lg">{teamName}</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto p-4">
            {error ? (
              <p role="alert" className="py-10 text-center text-sm text-destructive">
                {error}
              </p>
            ) : (
              <AuditLog teamId={teamId} initial={page} />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
