import { ArrowLeft, Crown, UsersRound } from "lucide-react";
import Link from "next/link";

import type { BoardViewer } from "./types";
import { RegisterButton } from "./register-button";

type Props = {
  hackathon: {
    slug: string;
    name: string;
    description: string;
    minTeamSize: number;
    maxTeamSize: number;
    stats: { participants: number; teams: number; lookingTeams: number };
  };
  viewer: BoardViewer & { isLeader: boolean };
};

/** Top of /hackathons/[slug]: the hackathon, its numbers, and where the viewer stands. */
export function HackathonHeader({ hackathon, viewer }: Props) {
  const sizes =
    hackathon.minTeamSize === hackathon.maxTeamSize
      ? `Teams of ${hackathon.maxTeamSize}`
      : `Teams of ${hackathon.minTeamSize}–${hackathon.maxTeamSize}`;
  const stats = [
    { label: "participants", value: hackathon.stats.participants },
    { label: "teams", value: hackathon.stats.teams },
    { label: "looking for members", value: hackathon.stats.lookingTeams },
  ];

  return (
    <div>
      <Link
        href="/hackathons"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All hackathons
      </Link>

      <div className="mt-4 flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 max-w-3xl">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">{hackathon.name}</h1>
            <span className="rounded-full bg-foreground px-2.5 py-1 text-[10px] font-semibold tracking-wider text-background uppercase">
              {sizes}
            </span>
          </div>
          {hackathon.description.trim() && (
            <p className="mt-2 text-muted-foreground">{hackathon.description}</p>
          )}
          <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {stats.map((stat) => (
              <div key={stat.label} className="flex items-baseline gap-1.5">
                <dt className="sr-only">{stat.label}</dt>
                <dd className="font-semibold tabular-nums">{stat.value}</dd>
                <span className="text-muted-foreground">{stat.label}</span>
              </div>
            ))}
          </dl>
        </div>

        <div className="w-full shrink-0 rounded-xl bg-card p-4 ring-1 ring-border lg:w-72">
          {!viewer.registered ? (
            <>
              <p className="font-medium">You&apos;re not registered yet</p>
              <p className="mt-1 mb-3 text-sm text-muted-foreground">
                Register to join a team or start your own.
              </p>
              <RegisterButton slug={hackathon.slug} />
            </>
          ) : viewer.team ? (
            <>
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <UsersRound className="size-4" aria-hidden />
                Your team
              </p>
              <p className="mt-1 flex items-center gap-2 font-semibold">
                {viewer.team.name}
                {viewer.isLeader && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
                    <Crown className="size-3" aria-hidden />
                    Leader
                  </span>
                )}
              </p>
            </>
          ) : (
            <>
              <p className="font-medium">You&apos;re registered</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Not in a team yet: join one below.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
