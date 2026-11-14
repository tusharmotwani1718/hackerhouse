// Flow 4 (ask to join an APPROVAL team), Flow 2 (the leader approves / declines), the leader's
// inbox and "my requests", and the settlement rules: R9 (in a team → my other requests are
// cancelled), R13 (declined by the leader → no re-request), R24 (team full → its requests
// are declined).
import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import { db, resetDb } from "../config/db";
import { api } from "../config/http";
import {
  createHackathon,
  createTeam,
  createUsers,
  registeredUsers,
  type Registered,
} from "../config/seed";
import { withTestApp } from "../config/suite";

withTestApp();

/** An APPROVAL team led by `leader` (plus optional members), in a hackathon of `max`. */
async function approvalTeam(hackathonId: string, max: number, members: Registered[]) {
  return createTeam({
    hackathonId,
    maxSize: max,
    memberParticipantIds: members.map((m) => m.participantId),
    joinPolicy: "APPROVAL",
  });
}

const ask = (who: Registered, teamId: string) =>
  api("POST", `/api/teams/${teamId}/requests`, { cookie: who.cookie });
const approve = (leader: Registered, requestId: string) =>
  api("POST", `/api/requests/${requestId}/approve`, { cookie: leader.cookie });
const decline = (leader: Registered, requestId: string) =>
  api("POST", `/api/requests/${requestId}/decline`, { cookie: leader.cookie });

// ------------------------------------------------------------------------------ ask (Flow 4)

test("ask to join an APPROVAL team → 201 PENDING, audit row", async () => {
  const hackathon = await createHackathon(4);
  const [leader, me] = await registeredUsers(hackathon.id, 2, "ask");
  const team = await approvalTeam(hackathon.id, 4, [leader!]);

  const res = await ask(me!, team.id);

  expect(res.status).toBe(201);
  expect(res.data.request).toMatchObject({ teamId: team.id, status: "PENDING" });
  const row = await db.joinRequest.findUniqueOrThrow({ where: { id: res.data.request.id } });
  expect(row).toMatchObject({ participantId: me!.participantId, status: "PENDING" });
  expect(await db.auditLog.count({ where: { teamId: team.id, action: "REQUEST_CREATED" } })).toBe(
    1,
  );
  // Not a member yet: asking changes nothing about the team.
  expect((await db.team.findUniqueOrThrow({ where: { id: team.id } })).memberCount).toBe(1);
});

test("ask refused: OPEN → USE_JOIN, INVITE_ONLY → INVITE_REQUIRED, full, in a team", async () => {
  const hackathon = await createHackathon(2);
  const [a, b, c, d, e, me] = await registeredUsers(hackathon.id, 6, "refuse");
  const open = await createTeam({
    hackathonId: hackathon.id,
    maxSize: 2,
    memberParticipantIds: [a!.participantId],
  });
  const inviteOnly = await createTeam({
    hackathonId: hackathon.id,
    maxSize: 2,
    memberParticipantIds: [b!.participantId],
    joinPolicy: "APPROVAL",
    access: "INVITE_ONLY",
  });
  const full = await approvalTeam(hackathon.id, 2, [c!, d!]);
  const target = await approvalTeam(hackathon.id, 2, [e!]);

  const r1 = await ask(me!, open.id);
  const r2 = await ask(me!, inviteOnly.id);
  const r3 = await ask(me!, full.id);
  // `a` leads the OPEN team: already in a team.
  const r4 = await ask(a!, target.id);

  expect([r1.status, r1.error?.code]).toEqual([409, "USE_JOIN"]);
  expect([r2.status, r2.error?.code]).toEqual([403, "INVITE_REQUIRED"]);
  expect([r3.status, r3.error?.code]).toEqual([409, "TEAM_FULL"]);
  expect([r4.status, r4.error?.code]).toEqual([409, "ALREADY_IN_TEAM"]);
  expect(await db.joinRequest.count()).toBe(0);
});

test("asking twice → 409 REQUEST_ALREADY_PENDING; after a leader decline → PREVIOUSLY_DECLINED (R13)", async () => {
  const hackathon = await createHackathon(4);
  const [leader, me] = await registeredUsers(hackathon.id, 2, "twice");
  const team = await approvalTeam(hackathon.id, 4, [leader!]);

  const first = await ask(me!, team.id);
  const again = await ask(me!, team.id);
  expect(first.status).toBe(201);
  expect([again.status, again.error?.code]).toEqual([409, "REQUEST_ALREADY_PENDING"]);

  expect((await decline(leader!, first.data.request.id)).status).toBe(200);
  const afterDecline = await ask(me!, team.id);
  expect([afterDecline.status, afterDecline.error?.code]).toEqual([409, "PREVIOUSLY_DECLINED"]);
  expect(await db.joinRequest.count()).toBe(1);
});

test("asking several teams at once is allowed (no cap, R27)", async () => {
  const hackathon = await createHackathon(4);
  const [l1, l2, l3, me] = await registeredUsers(hackathon.id, 4, "many");
  const teams = await Promise.all([l1!, l2!, l3!].map((l) => approvalTeam(hackathon.id, 4, [l])));

  const results = await Promise.all(teams.map((t) => ask(me!, t.id)));

  expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
  expect(await db.joinRequest.count({ where: { status: "PENDING" } })).toBe(3);
});

// --------------------------------------------------------------------- approve / decline (Flow 2)

test("approve → requester joins, other requests of theirs are cancelled (R9)", async () => {
  const hackathon = await createHackathon(4);
  const [leaderA, leaderB, me] = await registeredUsers(hackathon.id, 3, "approve");
  const teamA = await approvalTeam(hackathon.id, 4, [leaderA!]);
  const teamB = await approvalTeam(hackathon.id, 4, [leaderB!]);
  const toA = await ask(me!, teamA.id);
  const toB = await ask(me!, teamB.id);

  const res = await approve(leaderA!, toA.data.request.id);

  expect(res.status).toBe(200);
  expect(res.data.request).toMatchObject({ id: toA.data.request.id, status: "APPROVED" });
  expect(res.data.team).toMatchObject({ id: teamA.id, memberCount: 2 });
  const p = await db.participant.findUniqueOrThrow({ where: { id: me!.participantId } });
  expect(p.teamId).toBe(teamA.id);
  const other = await db.joinRequest.findUniqueOrThrow({ where: { id: toB.data.request.id } });
  expect(other.status).toBe("CANCELLED");
  const audit = await db.auditLog.findMany({ where: { teamId: teamA.id }, orderBy: { id: "asc" } });
  expect(audit.slice(-2).map((a) => a.action)).toEqual(["REQUEST_APPROVED", "MEMBER_JOINED"]);
  // Too late for team B's leader: the request is no longer pending.
  const late = await approve(leaderB!, toB.data.request.id);
  expect([late.status, late.error?.code]).toEqual([409, "REQUEST_NOT_PENDING"]);
  expect(late.error?.details).toMatchObject({ status: "CANCELLED" });
});

test("approving the last seat declines everyone else's requests to that team (R24)", async () => {
  const hackathon = await createHackathon(3);
  const [leader, member, x, y, z] = await registeredUsers(hackathon.id, 5, "r24");
  const team = await approvalTeam(hackathon.id, 3, [leader!, member!]); // 1 seat left
  const reqs: string[] = [];
  for (const who of [x!, y!, z!]) reqs.push((await ask(who, team.id)).data.request.id);

  const res = await approve(leader!, reqs[0]!);

  expect(res.status).toBe(200);
  expect(res.data.team.memberCount).toBe(3);
  const rows = await db.joinRequest.findMany({
    where: { teamId: team.id },
    orderBy: { id: "asc" },
  });
  expect(rows.map((r) => [r.status, r.declineReason])).toEqual([
    ["APPROVED", null],
    ["DECLINED", "TEAM_FULL"],
    ["DECLINED", "TEAM_FULL"],
  ]);
  // A TEAM_FULL decline isn't the leader's "no": it doesn't block asking again later (R13).
  expect(
    (await api("POST", `/api/teams/${team.id}/leave`, { cookie: member!.cookie })).status,
  ).toBe(200);
  const again = await ask(y!, team.id);
  expect(again.status).toBe(201);
});

test("decline → DECLINED (LEADER), the requester stays teamless", async () => {
  const hackathon = await createHackathon(4);
  const [leader, me] = await registeredUsers(hackathon.id, 2, "decline");
  const team = await approvalTeam(hackathon.id, 4, [leader!]);
  const asked = await ask(me!, team.id);

  const res = await decline(leader!, asked.data.request.id);

  expect(res.status).toBe(200);
  expect(res.data.request).toMatchObject({ status: "DECLINED", declineReason: "LEADER" });
  const p = await db.participant.findUniqueOrThrow({ where: { id: me!.participantId } });
  expect(p.teamId).toBeNull();
  // Deciding twice: the second answer says it's already decided.
  const again = await approve(leader!, asked.data.request.id);
  expect([again.status, again.error?.code]).toEqual([409, "REQUEST_NOT_PENDING"]);
  expect(again.error?.details).toMatchObject({ status: "DECLINED", declineReason: "LEADER" });
});

test("only the current leader decides: member → 403 NOT_LEADER; unknown request → 404", async () => {
  const hackathon = await createHackathon(4);
  const [leader, member, me] = await registeredUsers(hackathon.id, 3, "who");
  const team = await approvalTeam(hackathon.id, 4, [leader!, member!]);
  const asked = await ask(me!, team.id);
  const id = asked.data.request.id;

  for (const res of [
    await approve(member!, id),
    await decline(member!, id),
    await approve(me!, id),
  ]) {
    expect([res.status, res.error?.code]).toEqual([403, "NOT_LEADER"]);
  }
  for (const bad of [randomUUID(), "not-a-uuid"]) {
    const res = await approve(leader!, bad);
    expect([res.status, res.error?.code]).toEqual([404, "REQUEST_NOT_FOUND"]);
  }
  expect((await db.joinRequest.findUniqueOrThrow({ where: { id } })).status).toBe("PENDING");

  // Leadership moves when the leader leaves: the new leader can decide, the old one can't.
  expect(
    (await api("POST", `/api/teams/${team.id}/leave`, { cookie: leader!.cookie })).status,
  ).toBe(200);
  const old = await approve(leader!, id);
  expect([old.status, old.error?.code]).toEqual([403, "NOT_LEADER"]);
  expect((await approve(member!, id)).status).toBe(200);
});

// ------------------------------------------------------------------------------ concurrency

test("two leaders approve the same person at once → exactly one wins (10 rounds)", async () => {
  // Both approvals lock the REQUESTER's participant row first, so they run one after the
  // other; the second finds its request already cancelled by the first (R9).
  for (let round = 0; round < 10; round++) {
    await resetDb();
    const hackathon = await createHackathon(4);
    const [leaderA, leaderB, me] = await registeredUsers(hackathon.id, 3, `two${round}`);
    const teamA = await approvalTeam(hackathon.id, 4, [leaderA!]);
    const teamB = await approvalTeam(hackathon.id, 4, [leaderB!]);
    const toA = await ask(me!, teamA.id);
    const toB = await ask(me!, teamB.id);

    const results = await Promise.all([
      approve(leaderA!, toA.data.request.id),
      approve(leaderB!, toB.data.request.id),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.error?.code).toBe("REQUEST_NOT_PENDING");
    const counts = await db.team.findMany({ select: { memberCount: true } });
    expect(counts.reduce((sum, t) => sum + t.memberCount, 0)).toBe(3); // 1 + 1 + one approval
    expect(await db.joinRequest.count({ where: { status: "APPROVED" } })).toBe(1);
  }
}, 60_000);

test("leader approves while the requester joins another team → never both (10 rounds)", async () => {
  for (let round = 0; round < 10; round++) {
    await resetDb();
    const hackathon = await createHackathon(4);
    const [leaderA, leaderB, me] = await registeredUsers(hackathon.id, 3, `aj${round}`);
    const teamA = await approvalTeam(hackathon.id, 4, [leaderA!]);
    const open = await createTeam({
      hackathonId: hackathon.id,
      maxSize: 4,
      memberParticipantIds: [leaderB!.participantId],
    });
    const toA = await ask(me!, teamA.id);

    const [approved, joined] = await Promise.all([
      approve(leaderA!, toA.data.request.id),
      api("POST", `/api/teams/${open.id}/join`, { cookie: me!.cookie }),
    ]);

    // Exactly one of the two got me a team.
    expect([approved.status, joined.status].filter((s) => s === 200)).toHaveLength(1);
    const p = await db.participant.findUniqueOrThrow({ where: { id: me!.participantId } });
    expect(p.teamId).toBe(approved.status === 200 ? teamA.id : open.id);
    const req = await db.joinRequest.findUniqueOrThrow({ where: { id: toA.data.request.id } });
    expect(req.status).toBe(approved.status === 200 ? "APPROVED" : "CANCELLED");
  }
}, 60_000);

// ------------------------------------------------------------------------------------ reads

test("inbox: leader only; pending oldest first; paginated; other statuses by filter", async () => {
  const hackathon = await createHackathon(10);
  const [leader, member, ...askers] = await registeredUsers(hackathon.id, 7, "inbox");
  const team = await approvalTeam(hackathon.id, 10, [leader!, member!]);
  const ids: string[] = [];
  for (const who of askers) ids.push((await ask(who, team.id)).data.request.id); // in order
  await decline(leader!, ids[0]!);

  const url = `/api/teams/${team.id}/requests`;
  const page1 = await api("GET", `${url}?limit=2`, { cookie: leader!.cookie });
  expect(page1.status).toBe(200);
  expect(page1.data.totalCount).toBe(4); // pending ones
  expect(page1.data.requests.map((r: { id: string }) => r.id)).toEqual([ids[1], ids[2]]);
  expect(page1.nextCursor).toBeString();
  const page2 = await api("GET", `${url}?limit=2&cursor=${encodeURIComponent(page1.nextCursor!)}`, {
    cookie: leader!.cookie,
  });
  expect(page2.data.requests.map((r: { id: string }) => r.id)).toEqual([ids[3], ids[4]]);
  expect(page2.nextCursor).toBeNull();
  // What the leader sees about a requester: profile for judging, never an email or user id.
  const item = page1.data.requests[0];
  expect(item.requester).toMatchObject({
    participantId: askers[1]!.participantId,
    skills: { BACKEND: 3 },
  });
  expect(JSON.stringify(page1.data)).not.toContain("@test.local");
  expect(JSON.stringify(page1.data)).not.toContain(askers[1]!.id);

  const declined = await api("GET", `${url}?status=DECLINED`, { cookie: leader!.cookie });
  expect(declined.data.requests.map((r: { id: string }) => r.id)).toEqual([ids[0]]);

  const asMember = await api("GET", url, { cookie: member!.cookie });
  expect([asMember.status, asMember.error?.code]).toEqual([403, "NOT_LEADER"]);
  const badStatus = await api("GET", `${url}?status=MAYBE`, { cookie: leader!.cookie });
  expect([badStatus.status, badStatus.error?.code]).toEqual([400, "VALIDATION_FAILED"]);
});

test("my requests: every status, newest first, with the team; not registered → empty", async () => {
  const hackathon = await createHackathon(4);
  const [l1, l2, me, stranger] = await registeredUsers(hackathon.id, 4, "mine");
  const t1 = await approvalTeam(hackathon.id, 4, [l1!]);
  const t2 = await approvalTeam(hackathon.id, 4, [l2!]);
  const r1 = await ask(me!, t1.id);
  const r2 = await ask(me!, t2.id);
  await decline(l1!, r1.data.request.id);

  const res = await api("GET", `/api/hackathons/${hackathon.slug}/me/requests`, {
    cookie: me!.cookie,
  });

  expect(res.status).toBe(200);
  expect(res.data.requests.map((r: { id: string; status: string }) => [r.id, r.status])).toEqual([
    [r2.data.request.id, "PENDING"],
    [r1.data.request.id, "DECLINED"],
  ]);
  expect(res.data.requests[0].team).toMatchObject({ id: t2.id, seatsLeft: 3 });

  // Someone else's list doesn't show mine; not registered at all → empty, not an error.
  const [unregistered] = await createUsers(1, "unregistered");
  for (const other of [stranger!, unregistered!]) {
    const theirs = await api("GET", `/api/hackathons/${hackathon.slug}/me/requests`, {
      cookie: other.cookie,
    });
    expect(theirs.status).toBe(200);
    expect(theirs.data.requests).toEqual([]);
  }
});
