import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import { db, migrateTestDb, resetDb } from "../config/db";
import { assertTestDatabase, BASE_URL } from "../config/env";
import { api } from "../config/http";
import { completeProfiles, createHackathon, createUsers, sessionCookie } from "../config/seed";
import { startApp } from "../config/server";

let stopApp: (() => Promise<void>) | undefined;

beforeAll(async () => {
  assertTestDatabase(); //check we are not into main db
  migrateTestDb();
  stopApp = await startApp(); // start an app instance
}, 120_000); // starting the app may take some time

afterAll(async () => {
  await stopApp?.(); // stopApp could be undefined
  await db.$disconnect();
});

beforeEach(resetDb);

test("complete profile -> 201, one participant row, one audit row", async () => {
  // create the environment for the test
  const hackathon = await createHackathon(4);
  const [user] = await createUsers(1, "register");
  await completeProfiles([user!]);

  const res = await api("POST", `/api/hackathons/${hackathon.slug}/register`, {
    cookie: user?.cookie,
  });

  // assert the response:
  expect(res.status).toBe(201);
  expect(res.data.registered).toBe(true);

  // assert the db
  expect(
    await db.participant.count({ where: { userId: user!.id, hackathonId: hackathon.id } }),
  ).toBe(1);
  expect(
    await db.auditLog.count({
      where: { action: "PARTICIPANT_REGISTERED", hackathonId: hackathon.id },
    }),
  ).toBe(1);
});

test("registering twice → 409 ALREADY_REGISTERED, still one row", async () => {
  const hackathon = await createHackathon(4);
  const [user] = await createUsers(1, "register");
  await completeProfiles([user!]);

  // register for the first time:
  const first = await api("POST", `/api/hackathons/${hackathon.slug}/register`, {
    cookie: user!.cookie,
  });

  expect(first.status).toBe(201); // precondition: the first registration really happened

  // register same user for the second time:
  const registerUserAgain = await api("POST", `/api/hackathons/${hackathon.slug}/register`, {
    cookie: user!.cookie,
  });

  // assert the response:
  expect(registerUserAgain.status).toBe(409);
  expect(registerUserAgain.error?.code).toBe("ALREADY_REGISTERED");

  // assert the db:
  expect(
    await db.participant.count({ where: { userId: user?.id, hackathonId: hackathon.id } }),
  ).toBe(1);
});

test("incomplete profile → 409 PROFILE_INCOMPLETE, says what's missing, no row", async () => {
  const hackathon = await createHackathon(4);
  const [bare, githubOnly] = await createUsers(2, "incomplete");
  // `bare` has nothing; `githubOnly` has a GitHub username but no skills.
  await db.user.update({ where: { id: githubOnly!.id }, data: { githubUsername: "gh-only" } });

  const res1 = await api("POST", `/api/hackathons/${hackathon.slug}/register`, {
    cookie: bare!.cookie,
  });
  const res2 = await api("POST", `/api/hackathons/${hackathon.slug}/register`, {
    cookie: githubOnly!.cookie,
  });

  expect(res1.status).toBe(409);
  expect(res1.error?.code).toBe("PROFILE_INCOMPLETE");
  expect(res1.error?.details).toEqual({ missing: ["githubUsername", "skills"] });
  expect(res2.status).toBe(409);
  expect(res2.error?.details).toEqual({ missing: ["skills"] });

  // Nothing written: no participant, no audit row.
  expect(await db.participant.count({ where: { hackathonId: hackathon.id } })).toBe(0);
  expect(await db.auditLog.count({ where: { hackathonId: hackathon.id } })).toBe(0);
});

test("not signed in → 401 UNAUTHENTICATED (no cookie, forged cookie, unknown session)", async () => {
  const hackathon = await createHackathon(4);
  const [user] = await createUsers(1, "anon");
  await completeProfiles([user!]);
  const url = `/api/hackathons/${hackathon.slug}/register`;

  // 1. No cookie at all.
  const noCookie = await api("POST", url, { cookie: null });

  // 2. A real session token with a wrong signature: someone editing their cookie by hand.
  const [name, value] = [
    user!.cookie.slice(0, user!.cookie.indexOf("=")),
    decodeURIComponent(user!.cookie.slice(user!.cookie.indexOf("=") + 1)),
  ];
  const token = value.slice(0, value.lastIndexOf("."));
  const forged = await api("POST", url, {
    cookie: `${name}=${encodeURIComponent(`${token}.not-the-real-signature`)}`,
  });

  // 3. A correctly signed token that has no session row (expired / signed out / made up).
  const unknown = await api("POST", url, { cookie: sessionCookie("no-such-session-token") });

  for (const res of [noCookie, forged, unknown]) {
    expect(res.status).toBe(401);
    expect(res.error?.code).toBe("UNAUTHENTICATED");
  }
  expect(await db.participant.count({ where: { hackathonId: hackathon.id } })).toBe(0);
});

test("unknown hackathon → 404 HACKATHON_NOT_FOUND (slug or id)", async () => {
  const [user] = await createUsers(1, "lost");
  await completeProfiles([user!]);

  const bySlug = await api("POST", "/api/hackathons/no-such-hackathon/register", {
    cookie: user!.cookie,
  });
  const byId = await api("POST", `/api/hackathons/${randomUUID()}/register`, {
    cookie: user!.cookie,
  });

  expect(bySlug.status).toBe(404);
  expect(bySlug.error?.code).toBe("HACKATHON_NOT_FOUND");
  expect(byId.status).toBe(404);
  expect(byId.error?.code).toBe("HACKATHON_NOT_FOUND");
});

test("body must be {} → sending a userId is rejected with 400, nobody registered", async () => {
  // The server takes the user from the session cookie, never from the body. Here the attacker
  // tries to register someone else by putting the victim's id in the body.
  const hackathon = await createHackathon(4);
  const [attacker, victim] = await createUsers(2, "body");
  await completeProfiles([attacker!, victim!]);

  const res = await api("POST", `/api/hackathons/${hackathon.slug}/register`, {
    cookie: attacker!.cookie,
    body: { userId: victim!.id },
  });

  expect(res.status).toBe(400);
  expect(res.error?.code).toBe("VALIDATION_FAILED");
  expect(await db.participant.count({ where: { hackathonId: hackathon.id } })).toBe(0);
});

test("missing Idempotency-Key header → 400, nobody registered", async () => {
  const hackathon = await createHackathon(4);
  const [user] = await createUsers(1, "nokey");
  await completeProfiles([user!]);

  // Raw fetch: our api() helper always adds a key, and here we need it missing.
  const res = await fetch(`${BASE_URL}/api/hackathons/${hackathon.slug}/register`, {
    method: "POST",
    headers: { cookie: user!.cookie, "content-type": "application/json" },
    body: "{}",
  });
  const body = (await res.json()) as { error: { code: string } };

  expect(res.status).toBe(400);
  expect(body.error.code).toBe("VALIDATION_FAILED");
  expect(await db.participant.count({ where: { hackathonId: hackathon.id } })).toBe(0);
});

test("same Idempotency-Key twice → same 201 replayed, one row", async () => {
  const hackathon = await createHackathon(4);
  const [user] = await createUsers(1, "retry");
  await completeProfiles([user!]);
  const url = `/api/hackathons/${hackathon.slug}/register`;
  const key = randomUUID(); // ONE key, as a browser retry would resend it

  const first = await api("POST", url, { cookie: user!.cookie, key });
  const retry = await api("POST", url, { cookie: user!.cookie, key });

  expect(first.status).toBe(201);
  expect(retry.status).toBe(201); // NOT 409: a retry gets the original answer back
  expect(retry.data).toEqual(first.data); // identical, same participantId
  expect(first.headers.get("idempotent-replayed")).toBeNull();
  expect(retry.headers.get("idempotent-replayed")).toBe("true");
  expect(await db.participant.count({ where: { hackathonId: hackathon.id } })).toBe(1);
  expect(await db.auditLog.count({ where: { hackathonId: hackathon.id } })).toBe(1);
});

test("same key reused for a different request → 422 IDEMPOTENCY_KEY_REUSED", async () => {
  const hackathonA = await createHackathon(4);
  const hackathonB = await createHackathon(4);
  const [user] = await createUsers(1, "reuse");
  await completeProfiles([user!]);
  const key = randomUUID();

  const a = await api("POST", `/api/hackathons/${hackathonA.slug}/register`, {
    cookie: user!.cookie,
    key,
  });
  // A client bug: the same key for a DIFFERENT action (another hackathon).
  const b = await api("POST", `/api/hackathons/${hackathonB.slug}/register`, {
    cookie: user!.cookie,
    key,
  });

  expect(a.status).toBe(201);
  expect(b.status).toBe(422);
  expect(b.error?.code).toBe("IDEMPOTENCY_KEY_REUSED");
  expect(await db.participant.count({ where: { hackathonId: hackathonB.id } })).toBe(0);
});

test("two registrations at the same moment (different keys) → one 201, one 409", async () => {
  // A double-click that got two different keys, or two tabs. The UNIQUE (user_id,
  // hackathon_id) constraint settles it: the second INSERT waits, then finds the row.
  for (let round = 0; round < 10; round++) {
    await resetDb();
    const hackathon = await createHackathon(4);
    const [user] = await createUsers(1, `twin${round}`);
    await completeProfiles([user!]);
    const url = `/api/hackathons/${hackathon.slug}/register`;

    const results = await Promise.all([
      api("POST", url, { cookie: user!.cookie }),
      api("POST", url, { cookie: user!.cookie }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.error?.code).toBe("ALREADY_REGISTERED");
    expect(await db.participant.count({ where: { hackathonId: hackathon.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { hackathonId: hackathon.id } })).toBe(1);
  }
}, 30_000);

test("GET /me: not registered → registered:false; after register → the same participant", async () => {
  const hackathon = await createHackathon(4);
  const [user] = await createUsers(1, "me");
  await completeProfiles([user!]);
  const base = `/api/hackathons/${hackathon.slug}`;

  const before = await api("GET", `${base}/me`, { cookie: user!.cookie });
  expect(before.status).toBe(200); // "not registered" is a normal answer, not an error
  expect(before.data).toEqual({
    registered: false,
    participantId: null,
    registeredAt: null,
    team: null,
  });

  const reg = await api("POST", `${base}/register`, { cookie: user!.cookie });
  const after = await api("GET", `${base}/me`, { cookie: user!.cookie });

  expect(after.status).toBe(200);
  expect(after.data.registered).toBe(true);
  expect(after.data.participantId).toBe(reg.data.participantId);
  expect(after.data.team).toBeNull();

  const anon = await api("GET", `${base}/me`, { cookie: null });
  expect(anon.status).toBe(401);
});
