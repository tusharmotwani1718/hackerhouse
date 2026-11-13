import Link from "next/link";
import { Suspense } from "react";

import { Logo } from "@/components/brand/logo";
import { getCurrentSession } from "@/server/auth/current-session";

import { UserMenu } from "./user-menu";

/** Header of the signed-in app pages: logo (back to the landing page), nav, user menu. */
export function AppHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-8">
          <Logo />
          <nav className="hidden sm:block">
            <Link href="/hackathons" className="text-sm font-medium text-foreground">
              Hackathons
            </Link>
          </nav>
        </div>
        {/* The session is request data: rendered inside Suspense (cacheComponents). */}
        <Suspense fallback={<div className="h-9 w-28" aria-hidden />}>
          <HeaderUser />
        </Suspense>
      </div>
    </header>
  );
}

async function HeaderUser() {
  const session = await getCurrentSession();
  if (!session) return null; // the page itself redirects to /sign-in
  return (
    <UserMenu
      name={session.user.name}
      email={session.user.email}
      isAdmin={session.user.role === "ADMIN"}
    />
  );
}
