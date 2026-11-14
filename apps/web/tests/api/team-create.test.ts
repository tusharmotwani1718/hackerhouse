// Flow 6: POST /api/hackathons/{idOrSlug}/teams: create a team; the creator leads it.
import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import { db, resetDb } from "../config/db";
import { api } from "../config/http";
import { createHackathon, createTeam, createUsers, registeredUsers } from "../config/seed";
import { withTestApp } from "../config/suite";

withTestApp();

const body = (overrides: Record<string, unknown> = {}) => ({
  name: "Rocket Team",
  joinPolicy: "OPEN",
  access: "PUBLIC",
  ...overrides,
});

test("create → 201: creator leads, 1 member, invite code, audit rows", async () => {
  const hackathon = await createHackathon(4);
  const [me] = await registeredUsers(hackathon.id, 1, "creator");

  const res = await api("POST", `/api/hackathons/${hackathon.slug}/teams`, {
    cookie: me!.cookie,
    body: body({ description: "We build rockets" }),
  });

  expect(res.status).toBe(201);
  const { team, inviteCode } = res.data;
  expect(team).toMatchObject({
    name: "Rocket Team",
    description: "We build rockets",
    joinPolicy: "OPEN",
    access: "PUBLIC",
    isLooking: true, // default
    memberCount: 1,
    maxSize: 4, // copied from the hackathon
    version: 1,
  });
  // The code: 10 Crockford base32 characters; default life 7 days.
  expect(inviteCode.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);
  const lifeHours = (new Date(inviteCode.expiresAt).getTime() - Date.now()) / 3_600_000;
  expect(lifeHours).toBeGreaterThan(7 * 24 - 1);
  expect(lifeHours).toBeLessThanOrEqual(7 * 24);

  // Database: team, leader, membership, one code, two audit rows.
  const row = await db.team.findUniqueOrThrow({ where: { id: team.id } });
  expect(row.leaderParticipantId).toBe(me!.participantId);
  const participant = await db.participant.findUniqueOrThrow({ where: { id: me!.participantId } });
  expect(participant.teamId).toBe(team.id);
  expect(participant.teamJoinedAt).not.toBeNull();
  expect(await db.inviteCode.count({ where: { teamId: team.id, revokedAt: null } })).toBe(1);
  const audit = await db.auditLog.findMany({ where: { teamId: team.id }, orderBy: { id: "asc" } });
  expect(audit.map((a) => a.action)).toEqual(["TEAM_CREATED", "INVITE_CODE_GENERATED"]);
  // R28: the code itself is never written to the audit log.
  expect(JSON.stringify(audit)).not.toContain(inviteCode.code);
});

test("options: APPROVAL + INVITE_ONLY, not looking, invite life 1 hour", async () => {
  const hackathon = await createHackathon(4);
  const [me] = await registeredUsers(hackathon.id, 1, "options");

  const res = await api("POST", `/api/hackathons/${hackathon.slug}/teams`, {
    cookie: me!.cookie,
    body: body({
      joinPolicy: "APPROVAL",
      access: "INVITE_ONLY",
      isLooking: false,
      inviteExpiresInHours: 1,
    }),
  });

  expect(res.status).toBe(201);
  expect(res.data.team).toMatchObject({
    joinPolicy: "APPROVAL",
    access: "INVITE_ONLY",
    isLooking: false,
  });
  const lifeMinutes = (new Date(res.data.inviteCode.expiresAt).getTime() - Date.now()) / 60_000;
  expect(lifeMinutes).toBeGreaterThan(55);
  expect(lifeMinutes).toBeLessThanOrEqual(60);
});

test("name is trimmed and inner spaces collapsed", async () => {
  const hackathon = await createHackathon(4);
  const [me] = await registeredUsers(hackathon.id, 1, "spaces");

  const res = await api("POST", `/api/hackathons/${hackathon.slug}/teams`, {
    cookie: me!.cookie,
    body: body({ name: "   Rocket    Team  " }),
  });

  expect(res.status).toBe(201);
  expect(res.data.team.name).toBe("Rocket Team");
});

test("taken name (any letter case or spacing) → 409 TEAM_NAME_TAKEN", async () => {
  const hackathon = await createHackathon(4);
  const [first, second, third] = await registeredUsers(hackathon.id, 3, "names");
  const url = `/api/hackathons/${hackathon.slug}/teams`;

  const a = await api("POST", url, { cookie: first!.cookie, body: body() });
  const b = await api("POST", url, { cookie: second!.cookie, body: body({ name: "ROCKET TEAM" }) });
  const c = await api("POST", url, {
    cookie: third!.cookie,
    body: body({ name: "rocket   team" }),
  });

  expect(a.status).toBe(201);
  for (const res of [b, c]) {
    expect(res.status).toBe(409);
    expect(res.error?.code).toBe("TEAM_NAME_TAKEN");
  }
  // The losers stay teamless: the whole transaction rolled back.
  expect(await db.team.count({ where: { hackathonId: hackathon.id } })).toBe(1);
  expect(
    await db.participant.count({ where: { hackathonId: hackathon.id, teamId: { not: null } } }),
  ).toBe(1);
});

test("the same name is fine in another hackathon", async () => {
  const h1 = await createHackathon(4);
  const h2 = await createHackathon(4);
  const [a] = await registeredUsers(h1.id, 1, "h1");
  const [b] = await registeredUsers(h2.id, 1, "h2");

  const r1 = await api("POST", `/api/hackathons/${h1.slug}/teams`, {
    cookie: a!.cookie,
    body: body(),
  });
  const r2 = await api("POST", `/api/hackathons/${h2.slug}/teams`, {
    cookie: b!.cookie,
    body: body(),
  });

  expect(r1.status).toBe(201);
  expect(r2.status).toBe(201);
});

test("already in a team → 409 ALREADY_IN_TEAM, no second team", async () => {
  const hackathon = await createHackathon(4);
  const [me] = await registeredUsers(hackathon.id, 1, "twice");
  await createTeam({
    hackathonId: hackathon.id,
    maxSize: 4,
    memberParticipantIds: [me!.participantId],
  });

  const res = await api("POST", `/api/hackathons/${hackathon.slug}/teams`, {
    cookie: me!.cookie,
    body: body({ name: "Second Team" }),
  });

  expect(res.status).toBe(409);
  expect(res.error?.code).toBe("ALREADY_IN_TEAM");
  expect(await db.team.count({ where: { hackathonId: hackathon.id } })).toBe(1);
});

test("not registered → 403 NOT_REGISTERED; unknown hackathon → 404", async () => {
  const hackathon = await createHackathon(4);
  const [stranger] = await createUsers(1, "stranger");

  const notRegistered = await api("POST", `/api/hackathons/${hackathon.slug}/teams`, {
    cookie: stranger!.cookie,
    body: body(),
  });
  const unknown = await api("POST", "/api/hackathons/no-such-hackathon/teams", {
    cookie: stranger!.cookie,
    body: body(),
  });

  expect(notRegistered.status).toBe(403);
  expect(notRegistered.error?.code).toBe("NOT_REGISTERED");
  expect(unknown.status).toBe(404);
  expect(unknown.error?.code).toBe("HACKATHON_NOT_FOUND");
  expect(await db.team.count()).toBe(0);
});

test("invalid bodies → 400 VALIDATION_FAILED naming the field", async () => {
  const hackathon = await createHackathon(4);
  const [me] = await registeredUsers(hackathon.id, 1, "invalid");
  const url = `/api/hackathons/${hackathon.slug}/teams`;

  // [body, the field the error must point at]
  const cases: [Record<string, unknown>, string][] = [
    [body({ name: "ab" }), "name"], // too short (3–40)
    [body({ name: "x".repeat(41) }), "name"], // too long
    [body({ name: "   a   " }), "name"], // 1 character after trimming
    [body({ name: "Bad\u0007Name" }), "name"], // control character
    [body({ description: "x".repeat(501) }), "description"],
    [body({ joinPolicy: "ANYONE" }), "joinPolicy"],
    [body({ access: "SECRET" }), "access"],
    [body({ inviteExpiresInHours: 0 }), "inviteExpiresInHours"], // 1 h – 30 days
    [body({ inviteExpiresInHours: 721 }), "inviteExpiresInHours"],
    [body({ inviteExpiresInHours: 1.5 }), "inviteExpiresInHours"],
    [body({ maxSize: 10 }), "(root)"], // unknown field: the size comes from the hackathon
    [{ joinPolicy: "OPEN", access: "PUBLIC" }, "name"], // missing
  ];

  for (const [payload, field] of cases) {
    const res = await api("POST", url, { cookie: me!.cookie, body: payload });
    expect(res.status, JSON.stringify(payload).slice(0, 60)).toBe(400);
    expect(res.error?.code).toBe("VALIDATION_FAILED");
    const paths = (res.error?.details as { path: string }[]).map((d) => d.path);
    expect(paths, JSON.stringify(payload).slice(0, 60)).toContain(field);
  }
  expect(await db.team.count()).toBe(0);
});

test("double submit with the same key → one team, the SAME invite code twice", async () => {
  const hackathon = await createHackathon(4);
  const [me] = await registeredUsers(hackathon.id, 1, "double");
  const url = `/api/hackathons/${hackathon.slug}/teams`;
  const key = randomUUID();

  const [a, b] = await Promise.all([
    api("POST", url, { cookie: me!.cookie, body: body(), key }),
    api("POST", url, { cookie: me!.cookie, body: body(), key }),
  ]);

  expect(a.status).toBe(201);
  expect(b.status).toBe(201);
  expect(b.data).toEqual(a.data); // same team id, same code
  expect([a, b].filter((r) => r.headers.get("idempotent-replayed") === "true")).toHaveLength(1);
  expect(await db.team.count()).toBe(1);
  expect(await db.inviteCode.count()).toBe(1);
});

test("two creates at once with different keys → one team, the other ALREADY_IN_TEAM (10 rounds)", async () => {
  // Two tabs. The participant row lock serializes them: the second waits, then sees team_id set.
  for (let round = 0; round < 10; round++) {
    await resetDb();
    const hackathon = await createHackathon(4);
    const [me] = await registeredUsers(hackathon.id, 1, `tabs${round}`);
    const url = `/api/hackathons/${hackathon.slug}/teams`;

    const results = await Promise.all([
      api("POST", url, { cookie: me!.cookie, body: body({ name: "Tab One" }) }),
      api("POST", url, { cookie: me!.cookie, body: body({ name: "Tab Two" }) }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.error?.code).toBe("ALREADY_IN_TEAM");
    expect(await db.team.count()).toBe(1);
  }
}, 30_000);

test("creating a team cancels my pending join requests (R9)", async () => {
  const hackathon = await createHackathon(4);
  const [leader, me] = await registeredUsers(hackathon.id, 2, "r9");
  const other = await createTeam({
    hackathonId: hackathon.id,
    maxSize: 4,
    memberParticipantIds: [leader!.participantId],
    joinPolicy: "APPROVAL",
  });
  const asked = await api("POST", `/api/teams/${other.id}/requests`, { cookie: me!.cookie });
  expect(asked.status).toBe(201); // precondition: a pending request exists

  const created = await api("POST", `/api/hackathons/${hackathon.slug}/teams`, {
    cookie: me!.cookie,
    body: body({ name: "My Own Team" }),
  });

  expect(created.status).toBe(201);
  const request = await db.joinRequest.findFirstOrThrow({ where: { teamId: other.id } });
  expect(request.status).toBe("CANCELLED");
  expect(request.decidedByUserId).toBe(me!.id);
  expect(request.decidedAt).not.toBeNull();
});
