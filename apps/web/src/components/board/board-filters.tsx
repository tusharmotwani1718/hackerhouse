"use client";

import { Loader2, Search } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";

import { Input } from "@hacker-house/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@hacker-house/ui/components/select";

import { filtersToSearch, type BoardFilters } from "./types";

const ANY = "any";

const SHOW_ITEMS = [
  { value: "looking", label: "Looking for members" },
  { value: "all", label: "All teams" },
];
const POLICY_ITEMS = [
  { value: ANY, label: "Any" },
  { value: "OPEN", label: "Open: join instantly" },
  { value: "APPROVAL", label: "Approval: leader decides" },
];
const ACCESS_ITEMS = [
  { value: ANY, label: "Any" },
  { value: "PUBLIC", label: "Public" },
  { value: "INVITE_ONLY", label: "Invite only" },
];

/**
 * Left sidebar of the board. Every change is written to the URL (shareable, back button works);
 * the server re-renders the list for the new filters. The search waits until typing pauses.
 */
export function BoardFilters({ filters }: { filters: BoardFilters }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState(filters.q ?? "");

  // The URL's search changed from outside (back button, Clear all): show it in the box. While
  // typing, the URL catches up with the box, so nothing is overwritten.
  const [urlQ, setUrlQ] = useState(filters.q);
  if (filters.q !== urlQ) {
    setUrlQ(filters.q);
    if ((search.trim() || undefined) !== filters.q) setSearch(filters.q ?? "");
  }

  const apply = useCallback(
    (next: BoardFilters) => {
      const query = filtersToSearch(next).toString();
      startTransition(() => {
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
      });
    },
    [router, pathname],
  );

  // Search: apply 300 ms after the last keystroke.
  useEffect(() => {
    const q = search.trim() || undefined;
    if (q === filters.q) return;
    const timer = setTimeout(() => apply({ ...filters, q }), 300);
    return () => clearTimeout(timer);
  }, [search, filters, apply]);

  const active = Boolean(filters.q || filters.policy || filters.access || filters.show === "all");

  return (
    <aside className="h-fit rounded-xl bg-card p-4 ring-1 ring-border lg:sticky lg:top-24">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          Filters
          {isPending && (
            <Loader2
              className="size-3.5 animate-spin text-muted-foreground"
              aria-label="Updating"
            />
          )}
        </h2>
        {active && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              apply({ show: "looking" });
            }}
            className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Clear all
          </button>
        )}
      </div>

      <div className="relative mt-3">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search teams…"
          aria-label="Search teams by name"
          className="h-9 pl-8"
        />
      </div>

      <FilterSelect
        label="Show"
        items={SHOW_ITEMS}
        value={filters.show}
        onChange={(value) => apply({ ...filters, show: value as BoardFilters["show"] })}
      />
      <FilterSelect
        label="Join type"
        items={POLICY_ITEMS}
        value={filters.policy ?? ANY}
        onChange={(value) =>
          apply({
            ...filters,
            policy: value === ANY ? undefined : (value as BoardFilters["policy"]),
          })
        }
      />
      <FilterSelect
        label="Access"
        items={ACCESS_ITEMS}
        value={filters.access ?? ANY}
        onChange={(value) =>
          apply({
            ...filters,
            access: value === ANY ? undefined : (value as BoardFilters["access"]),
          })
        }
      />
    </aside>
  );
}

function FilterSelect({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="mt-4 border-t pt-4">
      <p className="mb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        {label}
      </p>
      <Select
        items={items}
        value={value}
        onValueChange={(next) => {
          if (typeof next === "string") onChange(next);
        }}
      >
        <SelectTrigger className="h-9 w-full" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
