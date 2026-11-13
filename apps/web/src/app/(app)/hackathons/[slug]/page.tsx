import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { BoardFilters } from "@/components/board/board-filters";
import { TeamList } from "@/components/board/team-list";
import { getCurrentSession } from "@/server/auth/current-session";
import { AppError } from "@/server/core/errors";
import { runReadTx } from "@/server/core/tx";
import { loadBoardPage, parseBoardFilters } from "@/server/modules/hackathons/board-page";

export const metadata: Metadata = { title: "Teams board · Hacker House" };

/**
 * "Teams board" tab (/hackathons/[slug]): filters (this tab only) + the team list. Filters live
 * in the URL (?q=&show=all&policy=&access=); the server renders the first page for them. The
 * header and tabs come from the layout.
 */
export default function TeamsBoardPage({ params, searchParams }: PageProps<"/hackathons/[slug]">) {
  return (
    <Suspense fallback={<BoardSkeleton />}>
      <TeamsBoard params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function TeamsBoard({ params, searchParams }: PageProps<"/hackathons/[slug]">) {
  const session = await getCurrentSession();
  if (!session) redirect("/sign-in");
  const { slug } = await params;
  const filters = parseBoardFilters(await searchParams);

  let data;
  try {
    data = await runReadTx((tx) => loadBoardPage(tx, session.user.id, slug, filters));
  } catch (error) {
    if (error instanceof AppError && error.code === "HACKATHON_NOT_FOUND") notFound();
    throw error;
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <BoardFilters filters={filters} />
      <TeamList
        slug={data.hackathon.slug}
        filters={filters}
        viewer={data.viewer}
        initial={{ teams: data.teams, totalCount: data.totalCount, nextCursor: data.nextCursor }}
      />
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[260px_minmax(0,1fr)]" aria-hidden>
      <div className="h-80 animate-pulse rounded-xl bg-muted" />
      <div className="grid gap-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-56 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    </div>
  );
}
