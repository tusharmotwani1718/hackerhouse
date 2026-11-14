// Flow 1 (join an OPEN team from the board) and Flow 3 (leave: cases A/B/C).
// The 50-way "last seat" race lives in tests/race; these are the rules around it.
import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import { db, resetDb } from "../config/db";
import { api } from "../config/http";
import { createHackathon, createTeam, createUsers, registeredUsers } from "../config/seed";
import { withTestApp } from "../config/suite";

withTestApp();

// ------------------------------------------------------------------------------------- join

test("join an OPEN team → 200: member added, count and version up, audit row", async () => {
  const hackathon = await createHackathon(4);
  const [leader, me] = await registeredUsers(hackathon.id, 2, "join");
  const team = await createTeam({
    hackathonId: hackathon.id,
    maxSize: 4,
    memberParticipantIds: [leader!.participantId],
  });

  const res = await api("POST", `/api/teams/${team.id}/join`, { cookie: me!.cookie });

  expect(res.status).toBe(200);
  expect(res.data.team).toMatchObject({ id: team.id, memberCount: 2, version: 2 });
  expect(res.data.joinedAt).toBeString();
  const participant = await db.participant.findUniqueOrThrow({ where: { id: me!.participantId } });
  expect(participant.teamId).toBe(team.id);
  const audit = await db.auditLog.findFirstOrThrow({
    where: { teamId: team.id, action: "MEMBER_JOINED" },
  });
  expect(audit.actorUserId).toBe(me!.id);
  expect(audit.metadata).toMatchObject({ via: "board", memberCount: 2 });
});

test("join is refused by the team's rules: APPROVAL → 409, INVITE_ONLY → 403, full → 409", async () => {
  const hackathon = await createHackathon(2);
  const [a, b, c, d, me] = await registeredUsers(hackathon.id, 5, "rules");
  const approval = await createTeam({
    hackathonId: hackathon.id,
    maxSize: 2,
    memberParticipantIds: [a!.participantId],
    joinPolicy: "APPROVAL",
  });
  const inviteOnly = await createTeam({
    hackathonId: hackathon.id,
    maxSize: 2,
    memberParticipantIds: [b!.participantId],
    access: "INVITE_ONLY",
  });
  const full = await createTeam({
    hackathonId: hackathon.id,
    maxSize: 2,
    memberParticipantIds: [c!.participantId, d!.participantId],
  });

  const r1 = await api("POST", `/api/teams/${approval.id}/join`, { cookie: me!.cookie });
  const r2 = await api("POST", `/api/teams/${inviteOnly.id}/join`, { cookie: me!.cookie });
  const r3 = await api("POST", `/api/teams/${full.id}/join`, { cookie: me!.cookie });

  expect([r1.status, r1.error?.code]).toEqual([409, "APPROVAL_REQUIRED"]);
  expect([r2.status, r2.error?.code]).toEqual([403, "INVITE_REQUIRED"]);
  expect([r3.status, r3.error?.code]).toEqual([409, "TEAM_FULL"]);
  const participant = await db.participant.findUniqueOrThrow({ where: { id: me!.participantId } });
  expect(participant.teamId).toBeNull();
});

test("join refused for the person: already in a team → 409, not registered → 403", async () => {
  const hackathon = await createHackathon(4);
  const [a, b] = await registeredUsers(hackathon.id, 2, "person");
  const [stranger] = await createUsers(1, "stranger");
  const teamA = await createTeam({
    hackathonId: hackathon.id,
    maxSize: 4,
    memberParticipantIds: [a!.participantId],
  });
  const teamB = await createTeam({
    hackathonId: hackathon.id,
    maxSize: 4,
    memberParticipantIds: [b!.participantId],
  });

  const inTeam = await api("POST", `/api/teams/${teamB.id}/join`, { cookie: a!.cookie });
  const notRegistered = await api("POST", `/api/teams/${teamA.id}/join`, {
    cookie: stranger!.cookie,
  });

  expect([inTeam.status, inTeam.error?.code]).toEqual([409, "ALREADY_IN_TEAM"]);
  expect([notRegistered.status, notRegistered.error?.code]).toEqual([403, "NOT_REGISTERED"]);
  const counts = await db.team.findMany({ select: { memberCount: true } });
  expect(counts.map((t) => t.memberCount)).toEqual([1, 1]);
});

test("unknown or malformed team id → 404 TEAM_NOT_FOUND", async () => {
  const hackathon = await createHackathon(4);
  const [me] = await registeredUsers(hackathon.id, 1, "lost");

  for (const id of [randomUUID(), "not-a-uuid"]) {
    const res = await api("POST", `/api/teams/${id}/join`, { cookie: me!.cookie });
    expect([res.status, res.error?.code]).toEqual([404, "TEAM_NOT_FOUND"]);
  }
});

test("joining cancels my pending requests to other teams (R9)", async () => {
  const hackathon = await createHackathon(4);
  const [leaderA, leaderB, me] = await registeredUsers(hackathon.id, 3, "r9");
  const approval = await createTeam({
    hackathonId: hackathon.id,
    maxSize: 4,
    memberParticipantIds: [leaderA!.participantId],
    joinPolicy: "APPROVAL",
  });
  const open = await createTeam({
    hackathonId: hackathon.id,
    maxSize: 4,
    memberParticipantIds: [leaderB!.participantId],
  });
  const asked = await api("POST", `/api/teams/${approval.id}/requests`, { cookie: me!.cookie });
  expect(asked.status).toBe(201);

  const joined = await api("POST", `/api/teams/${open.id}/join`, { cookie: me!.cookie });

  expect(joined.status).toBe(200);
  const request = await db.joinRequest.findFirstOrThrow({ where: { teamId: approval.id } });
  expect(request.status).toBe("CANCELLED");
});

// ------------------------------------------------------------------------------------ leave

test("leave case A: the last member leaves → team deleted with its codes and requests", async () => {
  const hackathon = await createHackathon(4);
  const [leader, asker] = await registeredUsers(hackathon.id, 2, "caseA");
  // Created through the API so the team has a real invite code.
  const created = await api("POST", `/api/hackathons/${hackathon.slug}/teams`, {
    cookie: leader!.cookie,
    body: { name: "Short Lived", joinPolicy: "APPROVAL", access: "PUBLIC" },
  });
  const teamId = created.data.team.id;
  const asked = await api("POST", `/api/teams/${teamId}/requests`, { cookie: asker!.cookie });
  expect(asked.status).toBe(201);

  const res = await api("POST", `/api/teams/${teamId}/leave`, { cookie: leader!.cookie });

  expect(res.status).toBe(200);
  expect(res.data).toEqual({ teamId, teamDeleted: true, newLeader: null });
  expect(await db.team.count({ where: { id: teamId } })).toBe(0);
  expect(await db.inviteCode.count({ where: { teamId } })).toBe(0); // ON DELETE CASCADE
  expect(await db.joinRequest.count({ where: { teamId } })).toBe(0);
  const participant = await db.participant.findUniqueOrThrow({
    where: { id: leader!.participantId },
  });
  expect(participant.teamId).toBeNull();
  // The audit log outlives the team (no FK), ending in the deletion.
  const audit = await db.auditLog.findMany({ where: { teamId }, orderBy: { id: "asc" } });
  expect(audit.slice(-2).map((a) => a.action)).toEqual(["MEMBER_LEFT", "TEAM_DELETED"]);
  expect(audit.at(-1)!.metadata).toMatchObject({ reason: "LAST_MEMBER_LEFT", droppedRequests: 1 });
});

test("leave case B: a member leaves → one seat frees, the leader stays", async () => {
  const hackathon = await createHackathon(4);
  const [leader, member] = await registeredUsers(hackathon.id, 2, "caseB");
  const team = await createTeam({
    hackathonId: hackathon.id,
    maxSize: 4,
    memberParticipantIds: [leader!.participantId, member!.participantId],
  });

  const res = await api("POST", `/api/teams/${team.id}/leave`, { cookie: member!.cookie });

  expect(res.status).toBe(200);
  expect(res.data).toEqual({ teamId: team.id, teamDeleted: false, newLeader: null });
  const row = await db.team.findUniqueOrThrow({ where: { id: team.id } });
  expect(row.memberCount).toBe(1);
  expect(row.version).toBe(2);
  expect(row.leaderParticipantId).toBe(leader!.participantId);
});

test("leave case C: the leader leaves → the longest-joined member leads (R6)", async () => {
  const hackathon = await createHackathon(4);
  // Joined in this order (the helper spaces them 1 s apart): leader, second, third.
  const [leader, second, third] = await registeredUsers(hackathon.id, 3, "caseC");
  const team = await createTeam({
    hackathonId: hackathon.id,
    maxSize: 4,
    memberParticipantIds: [leader!.participantId, second!.participantId, third!.participantId],
  });

  const res = await api("POST", `/api/teams/${team.id}/leave`, { cookie: leader!.cookie });

  expect(res.status).toBe(200);
  expect(res.data.teamDeleted).toBe(false);
  expect(res.data.newLeader).toMatchObject({
    participantId: second!.participantId,
    userId: second!.id,
  });
  const row = await db.team.findUniqueOrThrow({ where: { id: team.id } });
  expect(row.leaderParticipantId).toBe(second!.participantId);
  expect(row.memberCount).toBe(2);
  const changed = await db.auditLog.findFirstOrThrow({
    where: { teamId: team.id, action: "LEADER_CHANGED" },
  });
  expect(changed.metadata).toMatchObject({
    reason: "LEADER_LEFT",
    toParticipantId: second!.participantId,
  });
});

test("leave refused: not a member → 409 NOT_A_MEMBER; unknown team → 404", async () => {
  const hackathon = await createHackathon(4);
  const [leader, outsider] = await registeredUsers(hackathon.id, 2, "outsider");
  const team = await createTeam({
    hackathonId: hackathon.id,
    maxSize: 4,
    memberParticipantIds: [leader!.participantId],
  });

  const notMember = await api("POST", `/api/teams/${team.id}/leave`, { cookie: outsider!.cookie });
  const unknown = await api("POST", `/api/teams/${randomUUID()}/leave`, { cookie: leader!.cookie });

  expect([notMember.status, notMember.error?.code]).toEqual([409, "NOT_A_MEMBER"]);
  expect([unknown.status, unknown.error?.code]).toEqual([404, "TEAM_NOT_FOUND"]);
  expect((await db.team.findUniqueOrThrow({ where: { id: team.id } })).memberCount).toBe(1);
});

// ------------------------------------------------------------------------------ concurrency

test("the whole team leaves at once → all 200, team deleted exactly once (10 rounds)", async () => {
  // Every leave locks its own participant row, then queues on the team row. The last one in
  // the queue sees member_count 1 and deletes. (Step 5.1 found deadlocks here before
  // PARTICIPANT_LOCK; this test would catch them coming back.)
  for (let round = 0; round < 10; round++) {
    await resetDb();
    const hackathon = await createHackathon(4);
    const members = await registeredUsers(hackathon.id, 4, `all${round}`);
    const team = await createTeam({
      hackathonId: hackathon.id,
      maxSize: 4,
      memberParticipantIds: members.map((m) => m.participantId),
    });

    const results = await Promise.all(
      members.map((m) => api("POST", `/api/teams/${team.id}/leave`, { cookie: m.cookie })),
    );

    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(results.filter((r) => r.data.teamDeleted)).toHaveLength(1);
    expect(await db.team.count()).toBe(0);
    expect(await db.participant.count({ where: { teamId: { not: null } } })).toBe(0);
    expect(await db.auditLog.count({ where: { action: "TEAM_DELETED" } })).toBe(1);
  }
}, 60_000);

test("the last member leaves while someone joins → either order, never a broken team (10 rounds)", async () => {
  // Two valid outcomes, decided by who gets the team lock first:
  //  - join first: the team has 2, the leader leaves, the joiner leads (case C);
  //  - leave first: the team is deleted, the join gets 404 TEAM_NOT_FOUND.
  for (let round = 0; round < 10; round++) {
    await resetDb();
    const hackathon = await createHackathon(4);
    const [leader, joiner] = await registeredUsers(hackathon.id, 2, `lj${round}`);
    const team = await createTeam({
      hackathonId: hackathon.id,
      maxSize: 4,
      memberParticipantIds: [leader!.participantId],
    });

    const [left, joined] = await Promise.all([
      api("POST", `/api/teams/${team.id}/leave`, { cookie: leader!.cookie }),
      api("POST", `/api/teams/${team.id}/join`, { cookie: joiner!.cookie }),
    ]);

    expect(left.status).toBe(200);
    const row = await db.team.findUnique({ where: { id: team.id } });
    if (joined.status === 200) {
      expect(left.data.newLeader?.participantId).toBe(joiner!.participantId);
      expect(row).toMatchObject({ memberCount: 1, leaderParticipantId: joiner!.participantId });
    } else {
      expect([joined.status, joined.error?.code]).toEqual([404, "TEAM_NOT_FOUND"]);
      expect(left.data.teamDeleted).toBe(true);
      expect(row).toBeNull();
      const p = await db.participant.findUniqueOrThrow({ where: { id: joiner!.participantId } });
      expect(p.teamId).toBeNull();
    }
  }
}, 60_000);
