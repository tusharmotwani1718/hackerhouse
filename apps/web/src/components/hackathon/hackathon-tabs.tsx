"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@hacker-house/ui/lib/utils";

/** Tabs of a hackathon: each is its own URL (shareable, back button works). */
export function HackathonTabs({ slug, action }: { slug: string; action?: React.ReactNode }) {
  const pathname = usePathname();
  const base = `/hackathons/${slug}`;
  const tabs = [
    { href: base, label: "Teams board" },
    { href: `${base}/team`, label: "My team" },
    { href: `${base}/requests`, label: "My requests" },
  ];

  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b">
      <nav aria-label="Hackathon sections" className="-mb-px flex gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "border-b-2 px-3 pb-3 text-sm font-medium whitespace-nowrap transition-colors",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      {action && <div className="pb-2">{action}</div>}
    </div>
  );
}
