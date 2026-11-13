"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@hacker-house/ui/lib/utils";

/** Tabs of a hackathon: each is its own URL (shareable, back button works). */
export function HackathonTabs({
  slug,
  action,
  teamBadge,
}: {
  slug: string;
  action?: React.ReactNode;
  /** Pending join requests (leaders of APPROVAL teams), shown on "My team". */
  teamBadge?: number | null;
}) {
  const pathname = usePathname();
  const base = `/hackathons/${slug}`;
  const tabs: { href: string; label: string; badge?: number }[] = [
    { href: base, label: "Teams board" },
    { href: `${base}/team`, label: "My team", badge: teamBadge ?? 0 },
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
              {!!tab.badge && (
                <span
                  aria-label={`${tab.badge} pending join requests`}
                  className="ml-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground tabular-nums"
                >
                  {tab.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      {action && <div className="pb-2">{action}</div>}
    </div>
  );
}
