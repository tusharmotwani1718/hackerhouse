import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { Button } from "@hacker-house/ui/components/button";

import { MyTeam } from "@/components/hackathon/my-team";
import { getCurrentSession } from "@/server/auth/current-session";
import { AppError } from "@/server/core/errors";
import { runReadTx } from "@/server/core/tx";
import { loadMyTeam } from "@/server/modules/hackathons/hackathon-pages";

export const metadata: Metadata = { title: "My team · Hacker House" };

/** "My team" tab: the viewer's team in this hackathon, or what to do to get one. */
export default function MyTeamPage({ params }: PageProps<"/hackathons/[slug]/team">) {
  return (
    <Suspense fallback={<div className="h-80 animate-pulse rounded-xl bg-muted" aria-hidden />}>
      <MyTeamTab params={params} />
    </Suspense>
  );
}

async function MyTeamTab({ params }: Pick<PageProps<"/hackathons/[slug]/team">, "params">) {
  const session = await getCurrentSession();
  if (!session) redirect("/sign-in");
  const { slug } = await params;

  let data;
  try {
    data = await runReadTx((tx) => loadMyTeam(tx, session.user.id, slug));
  } catch (error) {
    if (error instanceof AppError && error.code === "HACKATHON_NOT_FOUND") notFound();
    throw error;
  }

  if (data.team) return <MyTeam team={data.team} />;
  return (
    <div className="rounded-xl border border-dashed px-6 py-16 text-center">
      <p className="font-medium">You&apos;re not in a team yet</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        {data.registered
          ? "Join a team from the board, or create your own with the “Create team” button above."
          : "Register for this hackathon first (top right), then join or create a team."}
      </p>
      <Button
        variant="outline"
        nativeButton={false}
        render={<Link href={`/hackathons/${slug}`} />}
        className="mt-5 h-9"
      >
        Browse the teams board
      </Button>
    </div>
  );
}
