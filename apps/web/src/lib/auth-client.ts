import { createAuthClient } from "better-auth/react";

/**
 * Better Auth's browser client. No baseURL: it calls `/api/auth/*` on the current origin, the
 * same origin Better Auth trusts (BETTER_AUTH_URL), so its CSRF origin check passes.
 */
export const authClient = createAuthClient();

/** Where people land after signing in or up (temporary until the app pages exist). */
export const AFTER_AUTH_PATH = "/";
