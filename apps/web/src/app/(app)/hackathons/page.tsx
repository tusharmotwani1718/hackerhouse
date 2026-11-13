import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { CreateHackathonDialog } from "@/components/hackathons/create-hackathon-dialog";
import { HackathonCard } from "@/components/hackathons/hackathon-card";
import { getCurrentSession } from "@/server/auth/current-session";
import { runReadTx } from "@/server/core/tx";
import { listHackathons } from "@/server/modules/hackathons/service";

export const metadata: Metadata = { title: "Hackathons · Hacker House" };

const GRID = "grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

/**
 * Every hackathon as a card (newest first). Signed-in users only: proxy.ts turns away visitors
 * without a session cookie; here the session is checked for real. Admins also get the
 * "Create hackathon" button. Data comes straight from the service layer (no HTTP hop).
 */
export default function HackathonsPage() {
  return (
    <Suspense fallback={<HackathonsSkeleton />}>
      <Hackathons />
    </Suspense>
  );
}

async function Hackathons() {
  const session = await getCurrentSession();
  if (!session) redirect("/sign-in");
  const isAdmin = session.user.role === "ADMIN";
  const hackathons = await runReadTx((tx) => listHackathons(tx));

  return (
    <>
      <PageHeading action={isAdmin ? <CreateHackathonDialog /> : null} />
      {hackathons.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed px-6 py-16 text-center">
          <p className="font-medium">No hackathons yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {isAdmin
              ? "Create the first one with the button above."
              : "Check back soon: new hackathons appear here as soon as they are announced."}
          </p>
        </div>
      ) : (
        <div className={`mt-8 ${GRID}`}>
          {hackathons.map((hackathon, index) => (
            <HackathonCard key={hackathon.id} hackathon={hackathon} index={index} />
          ))}
        </div>
      )}
    </>
  );
}

function PageHeading({ action }: { action: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Hackathons</h1>
        <p className="mt-1 text-muted-foreground">
          Pick a hackathon to register, find a team or start your own.
        </p>
      </div>
      {action}
    </div>
  );
}

function HackathonsSkeleton() {
  return (
    <>
      <PageHeading action={null} />
      <div className={`mt-8 ${GRID}`} aria-hidden>
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-72 animate-pulse rounded-2xl bg-muted" />
        ))}
      </div>
    </>
  );
}
