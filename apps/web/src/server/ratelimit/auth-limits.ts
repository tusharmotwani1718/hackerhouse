import "server-only";

import { createHash } from "node:crypto";

import { MAX_BODY_BYTES } from "../core/validate";
import { clientIp, enforceLimits, type LimitCheck } from "./limiter";

/**
 * Limits for Better Auth's anonymous endpoints (06 §4–5, step 7.3), checked BEFORE Better Auth
 * runs: a rejected password guess then costs one Redis call instead of a scrypt hash.
 *
 *   sign-in → (email, IP) 5/15 min · email 20/15 min · IP 30/15 min — all or nothing
 *   sign-up → IP 10/hour
 *
 * Every attempt counts, successful ones too (06 §2.2: whether the password was right is known
 * only after the expensive work). Other auth routes (get-session, sign-out, list/revoke
 * sessions) are not limited here: cheap, session-only; anonymous floods are nginx's (Phase 11).
 */
export async function enforceAuthLimits(req: Request): Promise<void> {
  if (req.method !== "POST") return;
  // Normalised so a path variant can't slip past the prefix check (Better Auth matches exact
  // lowercase paths; anything else is its 404 anyway).
  const path = new URL(req.url).pathname.toLowerCase().replace(/\/{2,}/g, "/");
  const ip = clientIp(req);

  if (path.startsWith("/api/auth/sign-in/")) {
    const checks: LimitCheck[] = [];
    const email = await readEmail(req);
    if (email) {
      const hashed = hashEmail(email);
      checks.push(
        { rule: "signin.email_ip", subject: `${hashed}:${ip}` },
        { rule: "signin.email", subject: hashed },
      );
    }
    // No usable email (not JSON, missing, too big) → the IP rule only; Better Auth rejects it.
    checks.push({ rule: "signin.ip", subject: ip });
    await enforceLimits(checks);
  } else if (path.startsWith("/api/auth/sign-up/")) {
    await enforceLimits([{ rule: "signup.ip", subject: ip }]);
  }
}

/**
 * The `email` field of the JSON body, trimmed + lowercased (so `Pat@X.com` and `pat@x.com`
 * share one counter), or null. Reads a CLONE: Better Auth still has to read the original.
 */
async function readEmail(req: Request): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return null;
  try {
    const text = await req.clone().text();
    if (text.length > MAX_BODY_BYTES) return null;
    const body: unknown = JSON.parse(text);
    if (typeof body !== "object" || body === null || !("email" in body)) return null;
    const { email } = body;
    if (typeof email !== "string") return null;
    const normalised = email.trim().toLowerCase();
    return normalised.length > 0 && normalised.length <= 320 ? normalised : null;
  } catch {
    return null;
  }
}

/** Redis keys hold a hash, never the email itself (keys show up in KEYS/SCAN, logs, dumps). */
function hashEmail(email: string): string {
  return createHash("sha256").update(email).digest("hex").slice(0, 32);
}
