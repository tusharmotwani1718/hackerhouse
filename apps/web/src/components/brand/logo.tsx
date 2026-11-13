import { Sparkles } from "lucide-react";
import Link from "next/link";

import { cn } from "@hacker-house/ui/lib/utils";

/** The "Hacker House" wordmark, linking home. */
export function Logo({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn("flex items-center gap-2 text-lg font-semibold tracking-tight", className)}
    >
      <Sparkles className="size-4 text-primary" aria-hidden />
      Hacker House
    </Link>
  );
}
