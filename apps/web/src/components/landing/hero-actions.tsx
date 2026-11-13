import Link from "next/link";

import { Button } from "@hacker-house/ui/components/button";

import { getCurrentSession } from "@/server/auth/current-session";

/*
 * The landing page's buttons depend on who is looking: signed out → Sign in / Get started,
 * signed in → Go to hackathons (no auth buttons). They read the session, so the hero renders
 * them inside <Suspense> (cacheComponents); the fallbacks only hold the space, so nobody sees
 * the wrong buttons flash first.
 */

const HEADER_GHOST = "h-9 rounded-full bg-card px-4 shadow-sm ring-1 ring-border";
const HEADER_SOLID =
  "h-9 rounded-full bg-foreground px-4 text-background hover:bg-foreground/85 sm:inline-flex";
const CTA =
  "h-11 rounded-full px-6 text-[0.95rem] shadow-[0_12px_32px_-10px_var(--primary)] ring-1 ring-white/30 ring-inset hover:bg-primary/90";

/** Right side of the hero header. */
export async function HeroHeaderActions() {
  const session = await getCurrentSession();
  if (session) {
    return (
      <Button nativeButton={false} render={<Link href="/hackathons" />} className={HEADER_SOLID}>
        Go to hackathons
      </Button>
    );
  }
  return (
    <>
      <Button
        variant="outline"
        nativeButton={false}
        render={<Link href="/sign-in" />}
        className={HEADER_GHOST}
      >
        Sign in
      </Button>
      <Button
        nativeButton={false}
        render={<Link href="/sign-up" />}
        className={`hidden ${HEADER_SOLID}`}
      >
        Get started
      </Button>
    </>
  );
}

/** The hero's main call to action. */
export async function HeroCta() {
  const session = await getCurrentSession();
  return session ? (
    <Button nativeButton={false} render={<Link href="/hackathons" />} className={CTA}>
      Go to hackathons
    </Button>
  ) : (
    <Button nativeButton={false} render={<Link href="/sign-up" />} className={CTA}>
      Get started
    </Button>
  );
}

/** Space holders while the session is read (same height, invisible). */
export function HeroHeaderActionsFallback() {
  return <div className="h-9 w-24" aria-hidden />;
}

export function HeroCtaFallback() {
  return <div className="h-11 w-40" aria-hidden />;
}
