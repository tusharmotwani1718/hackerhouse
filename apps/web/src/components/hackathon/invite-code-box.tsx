"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { Button } from "@hacker-house/ui/components/button";

import { DATE } from "./types";

/** The team's active invite code with a copy button (members only, R28). */
export function InviteCodeBox({ code, expiresAt }: { code: string; expiresAt: string }) {
  const [copied, setCopied] = useState(false);
  // Shown in groups for reading aloud / typing; the redeem form accepts it with or without dashes.
  const pretty = `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(pretty);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (permissions / insecure context): the code stays visible to copy by hand.
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 px-4 py-3">
      <div>
        <p className="text-xs text-muted-foreground">Invite code</p>
        <p className="font-mono text-lg font-semibold tracking-widest">{pretty}</p>
        <p className="text-xs text-muted-foreground">
          Valid until {DATE.format(new Date(expiresAt))}
        </p>
      </div>
      <Button variant="outline" onClick={copy} className="h-9 gap-1.5">
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
