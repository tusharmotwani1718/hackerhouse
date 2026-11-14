// Real HTTP sign-up / sign-in / sign-out (Better Auth), and the CSRF defences of our API.
// The only file that signs in over HTTP: everywhere else sessions are minted (06 §9.4).
// Better Auth answers in its own format ({ token, user } / { code, message }), not our envelope.
import { expect, test } from "bun:test";

import { db } from "../config/db";
import { BASE_URL } from "../config/env";
import { api } from "../config/http";
import { withTestApp } from "../config/suite";

withTestApp();

let ipCounter = 0;
/** Each test its own client IP (nginx's X-Real-IP), so per-IP auth limits don't add up. */
const freshIp = () => `10.0.0.${++ipCounter}`;

async function auth(path: string, body: unknown, ip: string, origin = BASE_URL) {
  const res = await fetch(`${BASE_URL}/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, "x-real-ip": ip },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  // "name=value" of the session cookie Better Auth set, if any.
  const setCookie = res.headers
    .getSetCookie()
    .find((c) => c.startsWith("better-auth.session_token="));
  return { status: res.status, json, cookie: setCookie?.split(";")[0] ?? null };
}

const account = (email: string) => ({ name: "Test Person", email, password: "correct-horse-1" });

test("sign up → session cookie that works on our API; role is USER", async () => {
  const ip = freshIp();

  const res = await auth("/sign-up/email", account("new@test.local"), ip);

  expect(res.status).toBe(200);
  expect(res.cookie).toBeString(); // autoSignIn
  const me = await api("GET", "/api/me", { cookie: res.cookie });
  expect(me.status).toBe(200);
  expect(me.data).toMatchObject({ email: "new@test.local", role: "USER", name: "Test Person" });
});

test("sign up can't choose a role (R14): `role` is ignored or refused, never stored", async () => {
  const res = await auth(
    "/sign-up/email",
    { ...account("climber@test.local"), role: "ADMIN" },
    freshIp(),
  );

  if (res.status === 200) {
    const row = await db.user.findUniqueOrThrow({ where: { email: "climber@test.local" } });
    expect(row.role).toBe("USER");
  } else {
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await db.user.count({ where: { email: "climber@test.local" } })).toBe(0);
  }
});

test("sign up refused: duplicate email, short password, blank name", async () => {
  const ip = freshIp();
  expect((await auth("/sign-up/email", account("dup@test.local"), ip)).status).toBe(200);

  const dup = await auth("/sign-up/email", account("dup@test.local"), ip);
  const shortPw = await auth(
    "/sign-up/email",
    { ...account("short@test.local"), password: "1234567" },
    ip,
  );
  const blank = await auth("/sign-up/email", { ...account("blank@test.local"), name: "   " }, ip);

  for (const res of [dup, shortPw, blank]) {
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.cookie).toBeNull();
  }
  expect(await db.user.count()).toBe(1);
});

test("sign in: right password → cookie; wrong password or unknown email → 401, same message", async () => {
  const ip = freshIp();
  await auth("/sign-up/email", account("login@test.local"), ip);

  const ok = await auth(
    "/sign-in/email",
    { email: "LOGIN@test.local", password: "correct-horse-1" },
    ip,
  );
  const wrong = await auth(
    "/sign-in/email",
    { email: "login@test.local", password: "wrong-horse-1" },
    ip,
  );
  const unknown = await auth(
    "/sign-in/email",
    { email: "nobody@test.local", password: "correct-horse-1" },
    ip,
  );

  expect(ok.status).toBe(200);
  expect((await api("GET", "/api/me", { cookie: ok.cookie })).status).toBe(200);
  expect(wrong.status).toBe(401);
  expect(unknown.status).toBe(401);
  // No account-exists oracle: both failures read the same.
  expect(wrong.json?.message).toBe(unknown.json?.message);
  expect(wrong.cookie).toBeNull();
});

test("sign out → the cookie stops working at once (no session cache)", async () => {
  const ip = freshIp();
  const { cookie } = await auth("/sign-up/email", account("bye@test.local"), ip);
  expect((await api("GET", "/api/me", { cookie })).status).toBe(200);

  const out = await fetch(`${BASE_URL}/api/auth/sign-out`, {
    method: "POST",
    headers: {
      cookie: cookie!,
      origin: BASE_URL,
      "content-type": "application/json",
      "x-real-ip": ip,
    },
    body: "{}",
  });

  expect(out.status).toBe(200);
  expect((await api("GET", "/api/me", { cookie })).status).toBe(401);
});

test("CSRF: sign-in from another site's origin is refused", async () => {
  const ip = freshIp();
  await auth("/sign-up/email", account("csrf@test.local"), ip);

  const res = await auth(
    "/sign-in/email",
    { email: "csrf@test.local", password: "correct-horse-1" },
    ip,
    "https://evil.example",
  );

  expect(res.status).toBe(403);
  expect(res.cookie).toBeNull();
});

test("CSRF: our API mutations need a JSON content type (a plain HTML form can't send one)", async () => {
  const ip = freshIp();
  const { cookie } = await auth("/sign-up/email", account("form@test.local"), ip);

  // What a hidden <form method=post> on another site would send, with the victim's cookie.
  const res = await fetch(`${BASE_URL}/api/me`, {
    method: "PATCH",
    headers: { cookie: cookie!, "content-type": "application/x-www-form-urlencoded" },
    body: "name=Hacked",
  });

  expect(res.status).toBe(415);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
    "UNSUPPORTED_MEDIA_TYPE",
  );
  const me = await api("GET", "/api/me", { cookie });
  expect(me.data.name).toBe("Test Person");
});
