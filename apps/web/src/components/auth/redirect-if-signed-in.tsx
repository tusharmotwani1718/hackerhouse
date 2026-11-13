import { redirect } from "next/navigation";

import { getCurrentSession } from "@/server/auth/current-session";

/**
 * Signed-in users can't use the auth pages: send them to the app. Rendered inside <Suspense>
 * by the auth layout, so the form itself stays a static page for everyone else.
 */
export async function RedirectIfSignedIn() {
  if (await getCurrentSession()) redirect("/hackathons");
  return null;
}
