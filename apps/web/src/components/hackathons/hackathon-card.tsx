import Link from "next/link";

import { Button } from "@hacker-house/ui/components/button";
import { cn } from "@hacker-house/ui/lib/utils";

import { initials } from "@/lib/initials";

export type HackathonCardData = {
  slug: string;
  name: string;
  description: string;
  minTeamSize: number;
  maxTeamSize: number;
};

// Band colours, taken from the theme so they follow the tokens; cycled through the list.
const TINTS = ["bg-accent", "bg-secondary", "bg-chart-5/40", "bg-muted"];

function teamSizeLabel(min: number, max: number): string {
  return min === max ? `Teams of ${max}` : `Teams of ${min}–${max}`;
}

/** One hackathon in the list: tinted band with its initials, team-size badge, name, description. */
export function HackathonCard({
  hackathon,
  index,
}: {
  hackathon: HackathonCardData;
  index: number;
}) {
  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl bg-card ring-1 ring-border transition duration-200 hover:-translate-y-0.5 hover:shadow-lg">
      <div
        className={cn(
          "relative flex h-24 items-center justify-center",
          TINTS[index % TINTS.length],
        )}
      >
        <span
          aria-hidden
          className="flex size-16 items-center justify-center rounded-full bg-card text-lg font-semibold tracking-tight text-primary shadow-sm ring-4 ring-card/60"
        >
          {initials(hackathon.name)}
        </span>
        <span className="absolute -bottom-2.5 left-4 rounded-full bg-foreground px-2.5 py-1 text-[10px] font-semibold tracking-wider text-background uppercase">
          {teamSizeLabel(hackathon.minTeamSize, hackathon.maxTeamSize)}
        </span>
      </div>

      <div className="flex flex-1 flex-col p-4 pt-6">
        <h2 className="line-clamp-2 leading-snug font-semibold">{hackathon.name}</h2>
        <p className="my-2 line-clamp-3 text-sm text-muted-foreground">
          {hackathon.description.trim() || "No description yet."}
        </p>
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href={`/hackathons/${hackathon.slug}`} />}
          className="mt-auto h-9 w-full rounded-lg group-hover:border-foreground group-hover:bg-foreground group-hover:text-background"
        >
          View details
        </Button>
      </div>
    </article>
  );
}
