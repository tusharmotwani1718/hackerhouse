import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { HackathonHeader } from "@/components/board/hackathon-header";
import { CreateTeamDialog } from "@/components/hackathon/create-team-dialog";
import { HackathonTabs } from "@/components/hackathon/hackathon-tabs";
import { getCurrentSession } from "@/server/auth/current-session";
import { AppError } from "@/server/core/errors";
import { runReadTx } from "@/server/core/tx";
import { loadHackathonShell } from "@/server/modules/hackathons/hackathon-pages";

/**
 * Shared frame of a hackathon's tabs (Teams board / My team / My requests): header with the
 * viewer's status, the tab bar and "Create team". Each tab is its own page below.
 */
export default function HackathonLayout({ params, children }: LayoutProps<"/hackathons/[slug]">) {
  return (
    <div className="grid gap-6">
      <Suspense fallback={<ShellSkeleton />}>
        <HackathonShell params={params} />
      </Suspense>
      {children}
    </div>
  );
}

async function HackathonShell({ params }: Pick<LayoutProps<"/hackathons/[slug]">, "params">) {
  const session = await getCurrentSession();
  if (!session) redirect("/sign-in");
  const { slug } = await params;

  let shell;
  try {
    shell = await runReadTx((tx) => loadHackathonShell(tx, session.user.id, slug));
  } catch (error) {
    if (error instanceof AppError && error.code === "HACKATHON_NOT_FOUND") notFound();
    throw error;
  }

  const { hackathon, viewer } = shell;
  const disabledReason = !viewer.registered
    ? "Register for this hackathon first"
    : viewer.team
      ? `You're already in ${viewer.team.name}`
      : null;

  return (
    <>
      <HackathonHeader hackathon={hackathon} viewer={viewer} />
      <HackathonTabs
        slug={hackathon.slug}
        action={<CreateTeamDialog slug={hackathon.slug} disabledReason={disabledReason} />}
      />
    </>
  );
}

function ShellSkeleton() {
  return (
    <div className="grid gap-3" aria-hidden>
      <div className="h-4 w-32 animate-pulse rounded bg-muted" />
      <div className="h-9 w-72 animate-pulse rounded bg-muted" />
      <div className="h-4 w-96 max-w-full animate-pulse rounded bg-muted" />
      <div className="mt-4 h-10 animate-pulse rounded bg-muted" />
    </div>
  );
}
