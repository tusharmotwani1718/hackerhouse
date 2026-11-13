import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { MyRequestsList } from "@/components/hackathon/my-requests-list";
import { getCurrentSession } from "@/server/auth/current-session";
import { AppError } from "@/server/core/errors";
import { runReadTx } from "@/server/core/tx";
import { loadMyRequests } from "@/server/modules/hackathons/hackathon-pages";

export const metadata: Metadata = { title: "My requests · Hacker House" };

/** "My requests" tab: the viewer's join requests in this hackathon and what became of them. */
export default function MyRequestsPage({ params }: PageProps<"/hackathons/[slug]/requests">) {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-muted" aria-hidden />}>
      <MyRequestsTab params={params} />
    </Suspense>
  );
}

async function MyRequestsTab({ params }: Pick<PageProps<"/hackathons/[slug]/requests">, "params">) {
  const session = await getCurrentSession();
  if (!session) redirect("/sign-in");
  const { slug } = await params;

  let data;
  try {
    data = await runReadTx((tx) => loadMyRequests(tx, session.user.id, slug));
  } catch (error) {
    if (error instanceof AppError && error.code === "HACKATHON_NOT_FOUND") notFound();
    throw error;
  }

  return (
    <MyRequestsList
      slug={slug}
      initial={{ requests: data.requests, nextCursor: data.nextCursor }}
    />
  );
}
