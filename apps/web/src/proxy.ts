import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic first filter (Next 16 `proxy`, formerly middleware): no session cookie at all on
 * an app page → straight to /sign-in, without rendering anything. Only checks that a cookie
 * EXISTS; the real check (is the session valid?) happens in the pages (getCurrentSession).
 *
 * Deliberately NOT done here: sending signed-in users away from /sign-in. A stale cookie would
 * bounce between /sign-in (cookie present → /hackathons) and /hackathons (invalid → /sign-in)
 * forever; the auth pages check the session for real instead.
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();
  return NextResponse.redirect(new URL("/sign-in", request.url));
}

export const config = {
  matcher: ["/hackathons/:path*"],
};
