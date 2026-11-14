// The leader's tools: remove a member (Flow 7), "looking for teammates" (9a), and the invite
// code: view (9d), regenerate (9b), revoke (9c).
import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import { db, resetDb } from "../config/db";
import { api } from "../config/http";
import { createHackathon, createTeam, registeredUsers, type Registered } from "../config/seed";
import { withTestApp } from "../config/suite";

withTestApp();

/** A team created through the API (so it has a real invite code), plus members joined by DB. */
async function teamWithCode(hackathonSlug: string, leader: Registered, name = "Leader Team") {
  const res = await api("POST", `/api/hackathons/${hackathonSlug}/teams`, {
    cookie: leader.cookie,
    body: { name, joinPolicy: "OPEN", access: "PUBLIC" },
  });
  expect(res.status).toBe(201);
  return { teamId: res.data.team.id as string, code: res.data.inviteCode.code as string };
}

const remove = (leader: Registered, teamId: string, participantId: string) =>
  api("POST", `/api/teams/${teamId}/members/${participantId}/remove`, { cookie: leader.cookie });

// ------------------------------------------------------------------------- remove (Flow 7)

test("leader removes a member → 200: seat freed, member teamless, audit names them", async () => {
  const hackathon = await createHackathon(4);
  const [leader, member] = await registeredUsers(hackathon.id, 2, "remove");
  const team = await createTeam({
    hackathonId: hackathon.id,
    maxSize: 4,
    memberParticipantIds: [leader!.participantId, member!.participantId],
  });

  const res = await remove(leader!, team.id, member!.participantId);

  expect(res.status).toBe(200);
  expect(res.data).toMatchObject({
    teamId: team.id,
    removedParticipantId: member!.participantId,
    team: { memberCount: 1, version: 2 },
  });
  const p = await db.participant.findUniqueOrThrow({ where: { id: member!.participantId } });
  expect(p.teamId).toBeNull();
  const audit = await db.auditLog.findFirstOrThrow({
    where: { teamId: team.id, action: "MEMBER_REMOVED" },
  });
  expect(audit).toMatchObject({ actorUserId: leader!.id, targetUserId: member!.id });

  // Removed isn't banned: they can join a team again (even this one: it's OPEN).
  const back = await api("POST", `/api/teams/${team.id}/join`, { cookie: member!.cookie });
  expect(back.status).toBe(200);
});

test("remove refused: member → NOT_LEADER, self → CANNOT_REMOVE_SELF, other team's → NOT_A_MEMBER, unknown → 404", async () => {
  const hackathon = await createHackathon(4);
  const [leader, member, otherLeader] = await registeredUsers(hackathon.id, 3, "refuse");
  const team = await createTeam({
    hackathonId: hackathon.id,
    maxSize: 4,
    memberParticipantIds: [leader!.participantId, member!.participantId],
  });
  await createTeam({
    hackathonId: hackathon.id,
    maxSize: 4,
    memberParticipantIds: [otherLeader!.participantId],
  });

  const cases: [Awaited<ReturnType<typeof api>>, number, string][] = [
    [await remove(member!, team.id, leader!.participantId), 403, "NOT_LEADER"],
    [await remove(leader!, team.id, leader!.participantId), 409, "CANNOT_REMOVE_SELF"],
    [await remove(leader!, team.id, otherLeader!.participantId), 409, "NOT_A_MEMBER"],
    [await remove(leader!, team.id, randomUUID()), 404, "MEMBER_NOT_FOUND"],
    [await remove(leader!, team.id, "nope"), 404, "MEMBER_NOT_FOUND"],
    [await remove(leader!, "nope", member!.participantId), 404, "TEAM_NOT_FOUND"],
  ];
  for (const [res, status, code] of cases) {
    expect([res.status, res.error?.code]).toEqual([status, code]);
  }
  expect((await db.team.findUniqueOrThrow({ where: { id: team.id } })).memberCount).toBe(2);
});

test("remove and leave at the same moment → exactly one happens (10 rounds)", async () => {
  // Both lock the member's participant row first, so they run one after the other; the second
  // finds the member already gone → 409 NOT_A_MEMBER. The seat is freed exactly once.
  for (let round = 0; round < 10; round++) {
    await resetDb();
    const hackathon = await createHackathon(4);
    const [leader, member] = await registeredUsers(hackathon.id, 2, `rl${round}`);
    const team = await createTeam({
      hackathonId: hackathon.id,
      maxSize: 4,
      memberParticipantIds: [leader!.participantId, member!.participantId],
    });

    const results = await Promise.all([
      remove(leader!, team.id, member!.participantId),
      api("POST", `/api/teams/${team.id}/leave`, { cookie: member!.cookie }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.error?.code).toBe("NOT_A_MEMBER");
    expect((await db.team.findUniqueOrThrow({ where: { id: team.id } })).memberCount).toBe(1);
  }
}, 60_000);

// ------------------------------------------------------------------ looking for teammates (9a)

test("toggle looking: off → version up + audit; same value again → no write", async () => {
  const hackathon = await createHackathon(4);
  const [leader] = await registeredUsers(hackathon.id, 1, "look");
  const team = await createTeam({
    hackathonId: hackathon.id,
    maxSize: 4,
    memberParticipantIds: [leader!.participantId],
  });
  const url = `/api/teams/${team.id}`;

  const off = await api("PATCH", url, { cookie: leader!.cookie, body: { isLooking: false } });
  expect(off.status).toBe(200);
  expect(off.data.team).toMatchObject({ isLooking: false, version: 2 });

  // "Set to this value" is naturally idempotent: repeating it changes nothing.
  const again = await api("PATCH", url, { cookie: leader!.cookie, body: { isLooking: false } });
  expect(again.status).toBe(200);
  expect(again.data.team).toMatchObject({ isLooking: false, version: 2 });
  expect(await db.auditLog.count({ where: { teamId: team.id, action: "LOOKING_TOGGLED" } })).toBe(
    1,
  );
});

test("toggle looking refused: member → 403, on while full → 409 TEAM_FULL, bad body → 400", async () => {
  const hackathon = await createHackathon(2);
  const [leader, member] = await registeredUsers(hackathon.id, 2, "lookno");
  const team = await createTeam({
    hackathonId: hackathon.id,
    maxSize: 2,
    memberParticipantIds: [leader!.participantId, member!.participantId],
    isLooking: false,
  });
  const url = `/api/teams/${team.id}`;

  const asMember = await api("PATCH", url, { cookie: member!.cookie, body: { isLooking: false } });
  const whileFull = await api("PATCH", url, { cookie: leader!.cookie, body: { isLooking: true } });
  const badBody = await api("PATCH", url, { cookie: leader!.cookie, body: { isLooking: "yes" } });

  expect([asMember.status, asMember.error?.code]).toEqual([403, "NOT_LEADER"]);
  expect([whileFull.status, whileFull.error?.code]).toEqual([409, "TEAM_FULL"]);
  expect([badBody.status, badBody.error?.code]).toEqual([400, "VALIDATION_FAILED"]);
  expect((await db.team.findUniqueOrThrow({ where: { id: team.id } })).version).toBe(1);
});

// ------------------------------------------------------------------------ invite code (9b–9d)

test("view the code: members only (403 for others), never in the public team page", async () => {
  const hackathon = await createHackathon(4);
  const [leader, member, outsider] = await registeredUsers(hackathon.id, 3, "view");
  const { teamId, code } = await teamWithCode(hackathon.slug, leader!);
  expect((await api("POST", `/api/teams/${teamId}/join`, { cookie: member!.cookie })).status).toBe(
    200,
  );

  const asLeader = await api("GET", `/api/teams/${teamId}/invite-code`, { cookie: leader!.cookie });
  const asMember = await api("GET", `/api/teams/${teamId}/invite-code`, { cookie: member!.cookie });
  const asOutsider = await api("GET", `/api/teams/${teamId}/invite-code`, {
    cookie: outsider!.cookie,
  });

  expect(asLeader.status).toBe(200);
  expect(asLeader.data.code).toBe(code);
  expect(asMember.data.code).toBe(code); // any member can share it
  expect([asOutsider.status, asOutsider.error?.code]).toEqual([403, "MEMBERS_ONLY"]);
  // R28: the public team page and the board never carry it.
  const page = await api("GET", `/api/teams/${teamId}`, { cookie: outsider!.cookie });
  const board = await api("GET", `/api/hackathons/${hackathon.slug}/board`, {
    cookie: outsider!.cookie,
  });
  expect(page.status).toBe(200);
  expect(JSON.stringify(page.data)).not.toContain(code);
  expect(JSON.stringify(board.data)).not.toContain(code);
});

test("regenerate → new code, the old one stops working; a retry returns the SAME new code", async () => {
  const hackathon = await createHackathon(4);
  const [leader, joiner] = await registeredUsers(hackathon.id, 2, "regen");
  const { teamId, code: oldCode } = await teamWithCode(hackathon.slug, leader!);
  const key = randomUUID();

  const res = await api("POST", `/api/teams/${teamId}/invite-code`, {
    cookie: leader!.cookie,
    body: { expiresInHours: 24 },
    key,
  });
  const retry = await api("POST", `/api/teams/${teamId}/invite-code`, {
    cookie: leader!.cookie,
    body: { expiresInHours: 24 },
    key,
  });

  expect(res.status).toBe(201);
  const newCode = res.data.inviteCode.code;
  expect(newCode).not.toBe(oldCode);
  // Without idempotency a retry would revoke the code just shown and make another one.
  expect(retry.data.inviteCode.code).toBe(newCode);
  expect(await db.inviteCode.count({ where: { teamId } })).toBe(2); // old (revoked) + new
  expect(await db.inviteCode.count({ where: { teamId, revokedAt: null } })).toBe(1);

  const withOld = await api("POST", "/api/invites/redeem", {
    cookie: joiner!.cookie,
    body: { code: oldCode },
  });
  expect([withOld.status, withOld.error?.code]).toEqual([404, "INVALID_CODE"]);
  const withNew = await api("POST", "/api/invites/redeem", {
    cookie: joiner!.cookie,
    body: { code: newCode },
  });
  expect(withNew.status).toBe(200);
});

test("revoke → no active code: view and a second revoke say 404 NO_ACTIVE_CODE", async () => {
  const hackathon = await createHackathon(4);
  const [leader, member] = await registeredUsers(hackathon.id, 2, "revoke");
  const { teamId } = await teamWithCode(hackathon.slug, leader!);
  expect((await api("POST", `/api/teams/${teamId}/join`, { cookie: member!.cookie })).status).toBe(
    200,
  );
  const url = `/api/teams/${teamId}/invite-code`;

  const byMember = await api("DELETE", url, { cookie: member!.cookie });
  expect([byMember.status, byMember.error?.code]).toEqual([403, "NOT_LEADER"]);

  const revoked = await api("DELETE", url, { cookie: leader!.cookie });
  expect(revoked.status).toBe(200);
  expect(revoked.data).toEqual({ teamId, revoked: true });

  const view = await api("GET", url, { cookie: leader!.cookie });
  const twice = await api("DELETE", url, { cookie: leader!.cookie });
  expect([view.status, view.error?.code]).toEqual([404, "NO_ACTIVE_CODE"]);
  expect([twice.status, twice.error?.code]).toEqual([404, "NO_ACTIVE_CODE"]);

  // A member can't regenerate either; the leader can (a fresh code after a revoke).
  const regenByMember = await api("POST", url, { cookie: member!.cookie });
  expect([regenByMember.status, regenByMember.error?.code]).toEqual([403, "NOT_LEADER"]);
  expect((await api("POST", url, { cookie: leader!.cookie })).status).toBe(201);
});

test("regenerate validates expiresInHours (1–720)", async () => {
  const hackathon = await createHackathon(4);
  const [leader] = await registeredUsers(hackathon.id, 1, "hours");
  const { teamId } = await teamWithCode(hackathon.slug, leader!);

  for (const hours of [0, 721, 2.5, "24"]) {
    const res = await api("POST", `/api/teams/${teamId}/invite-code`, {
      cookie: leader!.cookie,
      body: { expiresInHours: hours },
    });
    expect([res.status, res.error?.code]).toEqual([400, "VALIDATION_FAILED"]);
  }
  expect(await db.inviteCode.count({ where: { teamId } })).toBe(1); // untouched
});
