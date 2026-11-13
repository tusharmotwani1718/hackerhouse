import "server-only";

import { headers } from "next/headers";
import { cache } from "react";

import { getAuth } from "./auth";
import type { AuthSession, Role } from "./session";

/**
 * The signed-in user for Server Components and pages, or null. The API routes use
 * requireUser(req) instead; this one reads the request headers itself.
 *
 * - cache(): several components of one request (header, page) share ONE session lookup.
 * - Reads request headers → under cacheComponents, call it only inside <Suspense>.
 * - Same source of truth as the API: the session row in the DB (no cookie cache), so a
 *   sign-out or a role change shows immediately.
 */
export const getCurrentSession = cache(async (): Promise<AuthSession | null> => {
  const result = await getAuth().api.getSession({ headers: await headers() });
  if (!result) return null;
  const { user, session } = result;
  return {
    user: { id: user.id, email: user.email, name: user.name, role: user.role as Role },
    session: { id: session.id, expiresAt: session.expiresAt },
  };
});
