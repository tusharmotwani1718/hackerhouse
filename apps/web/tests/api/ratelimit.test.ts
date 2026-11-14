// Rate limits (06): this file starts the app with TINY limits (RATE_LIMIT_OVERRIDES), so a few
// requests are enough to hit them. Checks: headers, 429 + Retry-After, per-user and per-IP
// keys, separate budgets, and that a limited request does no work.
import { expect, test } from "bun:test";

import { db } from "../config/db";
import { BASE_URL } from "../config/env";
import { api } from "../config/http";
import { createHackathon, createTeam, createUsers, registeredUsers } from "../config/seed";
import { withTestApp } from "../config/suite";

withTestApp({
  RATE_LIMIT_OVERRIDES: [
    "read.user=3/60s",
    "mutation.user=2/60s",
    "request.user=2/60s",
    "redeem.user=3/60s",
    "redeem.ip=5/60s",
    "signin.email_ip=2/60s",
    "signup.ip=2/60s",
  ].join(","),
});

const limitHeaders = (res: { headers: Headers }) => ({
  limit: res.headers.get("ratelimit-limit"),
  remaining: res.headers.get("ratelimit-remaining"),
  reset: res.headers.get("ratelimit-reset"),
});

test("reads: RateLimit-* headers count down; over the limit → 429 + Retry-After; per user", async () => {
  const [me, other] = await createUsers(2, "reader");

  const ok = [];
  for (let i = 0; i < 3; i++) ok.push(await api("GET", "/api/me", { cookie: me!.cookie }));
  const limited = await api("GET", "/api/me", { cookie: me!.cookie });

  expect(ok.map((r) => r.status)).toEqual([200, 200, 200]);
  expect(ok.map((r) => limitHeaders(r).remaining)).toEqual(["2", "1", "0"]);
  expect(limitHeaders(ok[0]!).limit).toBe("3");
  expect(Number(limitHeaders(ok[0]!).reset)).toBeGreaterThan(0);

  expect([limited.status, limited.error?.code]).toEqual([429, "RATE_LIMITED"]);
  expect(limited.error?.details).toMatchObject({ rule: "read.user" });
  const retryAfter = Number(limited.headers.get("retry-after"));
  expect(retryAfter).toBeGreaterThan(0);
  expect(retryAfter).toBeLessThanOrEqual(60);

  // Keys are per user: someone else isn't affected by my burst.
  expect((await api("GET", "/api/me", { cookie: other!.cookie })).status).toBe(200);
});

test("budgets are separate: out of reads, mutations still work; a limited mutation writes nothing", async () => {
  const [me] = await createUsers(1, "budgets");
  for (let i = 0; i < 3; i++) await api("GET", "/api/me", { cookie: me!.cookie });
  expect((await api("GET", "/api/me", { cookie: me!.cookie })).status).toBe(429);

  const m1 = await api("PATCH", "/api/me", { cookie: me!.cookie, body: { name: "One" } });
  const m2 = await api("PATCH", "/api/me", { cookie: me!.cookie, body: { name: "Two" } });
  const m3 = await api("PATCH", "/api/me", { cookie: me!.cookie, body: { name: "Three" } });

  expect([m1.status, m2.status]).toEqual([200, 200]);
  expect([m3.status, m3.error?.details?.rule]).toEqual([429, "mutation.user"]);
  // Rejected before the transaction (06 D9): the name is still "Two".
  expect((await db.user.findUniqueOrThrow({ where: { id: me!.id } })).name).toBe("Two");
});

test("join requests have their own budget (spam): the 3rd request in a minute → 429", async () => {
  const hackathon = await createHackathon(4);
  const [l1, l2, l3, me] = await registeredUsers(hackathon.id, 4, "spam");
  const teams = [];
  for (const leader of [l1!, l2!, l3!]) {
    teams.push(
      await createTeam({
        hackathonId: hackathon.id,
        maxSize: 4,
        memberParticipantIds: [leader.participantId],
        joinPolicy: "APPROVAL",
      }),
    );
  }

  const results = [];
  for (const team of teams) {
    results.push(await api("POST", `/api/teams/${team.id}/requests`, { cookie: me!.cookie }));
  }

  expect(results.map((r) => r.status)).toEqual([201, 201, 429]);
  expect(results[2]!.error?.details?.rule).toBe("request.user");
  expect(await db.joinRequest.count()).toBe(2);
});

test("invite redeem: every attempt counts (even wrong codes); per user AND per IP", async () => {
  const hackathon = await createHackathon(4);
  const [a, b] = await registeredUsers(hackathon.id, 2, "guess");
  const ipA = { "x-real-ip": "203.0.113.1" };
  const ipB = { "x-real-ip": "203.0.113.2" };
  const guess = (cookie: string, headers: Record<string, string>) =>
    api("POST", "/api/invites/redeem", { cookie, body: { code: "ZZZZZZZZZZ" }, headers });

  // User a: 3 wrong guesses allowed, the 4th is limited by the USER rule.
  const aTries = [];
  for (let i = 0; i < 4; i++) aTries.push(await guess(a!.cookie, ipA));
  expect(aTries.map((r) => r.status)).toEqual([404, 404, 404, 429]);
  expect(aTries[3]!.error?.details?.rule).toBe("redeem.user");

  // User b, same IP: the IP has used 3 of 5 (the limited 4th wasn't counted: all or nothing).
  const bTries = [];
  for (let i = 0; i < 3; i++) bTries.push(await guess(b!.cookie, ipA));
  expect(bTries.map((r) => r.status)).toEqual([404, 404, 429]);
  expect(bTries[2]!.error?.details?.rule).toBe("redeem.ip");

  // The same user b from another IP: their own budget (2 of 3 used) still has room.
  expect((await guess(b!.cookie, ipB)).status).toBe(404);
});

test("sign-in: 2 attempts per email+IP, then 429 even with the right password; another IP works", async () => {
  const signUp = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE_URL, "x-real-ip": "198.51.100.9" },
    body: JSON.stringify({
      name: "Victim",
      email: "victim@test.local",
      password: "correct-horse-1",
    }),
  });
  expect(signUp.status).toBe(200);
  const signIn = (password: string, ip: string) =>
    fetch(`${BASE_URL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE_URL, "x-real-ip": ip },
      body: JSON.stringify({ email: "victim@test.local", password }),
    });

  const statuses = [];
  for (const pw of ["wrong-1-xxxx", "wrong-2-xxxx", "correct-horse-1"]) {
    statuses.push((await signIn(pw, "198.51.100.1")).status);
  }
  expect(statuses).toEqual([401, 401, 429]);
  // Not a lockout for the real owner elsewhere (the email-only rule is looser on purpose).
  expect((await signIn("correct-horse-1", "198.51.100.2")).status).toBe(200);
});

test("sign-up: per-IP limit; the limited attempt creates no account", async () => {
  const signUp = (n: number) =>
    fetch(`${BASE_URL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE_URL, "x-real-ip": "192.0.2.50" },
      body: JSON.stringify({
        name: `Farm ${n}`,
        email: `farm${n}@test.local`,
        password: "correct-horse-1",
      }),
    });

  const statuses = [];
  for (let n = 1; n <= 3; n++) statuses.push((await signUp(n)).status);

  expect(statuses).toEqual([200, 200, 429]);
  expect(await db.user.count({ where: { email: { startsWith: "farm" } } })).toBe(2);
});

test("no session → 401 before any limit is counted (anonymous floods are nginx's job)", async () => {
  const results = [];
  for (let i = 0; i < 6; i++) results.push(await api("GET", "/api/me", { cookie: null }));

  expect(results.every((r) => r.status === 401)).toBe(true);
  expect(results[0]!.headers.get("ratelimit-limit")).toBeNull();
});
