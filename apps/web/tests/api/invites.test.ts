// POST /api/invites/redeem: the code picks the team, the team's policy picks the flow
// (OPEN → join, APPROVAL → request). Every bad code gets the same answer (no oracle).
import { expect, test } from "bun:test";

import { db } from "../config/db";
import { api } from "../config/http";
import { createHackathon, registeredUsers, type Registered } from "../config/seed";
import { withTestApp } from "../config/suite";

withTestApp();

async function createWithCode(
  slug: string,
  leader: Registered,
  joinPolicy: "OPEN" | "APPROVAL",
  access: "PUBLIC" | "INVITE_ONLY",
) {
  const res = await api("POST", `/api/hackathons/${slug}/teams`, {
    cookie: leader.cookie,
    body: {
      name: `${joinPolicy} ${access} ${leader.participantId.slice(-6)}`,
      joinPolicy,
      access,
    },
  });
  expect(res.status).toBe(201);
  return { teamId: res.data.team.id as string, code: res.data.inviteCode.code as string };
}

const redeem = (who: Registered, code: string) =>
  api("POST", "/api/invites/redeem", { cookie: who.cookie, body: { code } });

test("OPEN team's code → 200 JOINED (even when the team is invite-only)", async () => {
  const hackathon = await createHackathon(4);
  const [leader, me] = await registeredUsers(hackathon.id, 2, "open");
  const { teamId, code } = await createWithCode(hackathon.slug, leader!, "OPEN", "INVITE_ONLY");

  const res = await redeem(me!, code);

  expect(res.status).toBe(200);
  expect(res.data).toMatchObject({ outcome: "JOINED", team: { id: teamId, memberCount: 2 } });
  const audit = await db.auditLog.findFirstOrThrow({ where: { teamId, action: "MEMBER_JOINED" } });
  expect(audit.metadata).toMatchObject({ via: "code" });
});

test("APPROVAL team's code → 201 REQUESTED: a pending request, not a membership", async () => {
  const hackathon = await createHackathon(4);
  const [leader, me] = await registeredUsers(hackathon.id, 2, "approval");
  const { teamId, code } = await createWithCode(hackathon.slug, leader!, "APPROVAL", "INVITE_ONLY");

  const res = await redeem(me!, code);

  expect(res.status).toBe(201);
  expect(res.data).toMatchObject({ outcome: "REQUESTED", request: { teamId, status: "PENDING" } });
  const p = await db.participant.findUniqueOrThrow({ where: { id: me!.participantId } });
  expect(p.teamId).toBeNull();
  // The leader sees it in the inbox like any other request.
  const inbox = await api("GET", `/api/teams/${teamId}/requests`, { cookie: leader!.cookie });
  expect(inbox.data.totalCount).toBe(1);
});

test("typed-in forms are forgiven: lower case, hyphens, spaces, O→0 and I/L→1", async () => {
  const hackathon = await createHackathon(10);
  const [leader, ...joiners] = await registeredUsers(hackathon.id, 4, "typed");
  const { teamId } = await createWithCode(hackathon.slug, leader!, "OPEN", "PUBLIC");
  // A known code with 0 and 1 in it, so the look-alike rules can be tried.
  await db.inviteCode.updateMany({ where: { teamId }, data: { code: "01ABCDEFGH" } });

  const typed = ["01abc-defgh", " 01AB CDEF GH ", "OLABCDEFGH"]; // last: O → 0, L → 1
  for (const [i, code] of typed.entries()) {
    const res = await redeem(joiners[i]!, code);
    expect(res.status, code).toBe(200);
  }
  expect((await db.team.findUniqueOrThrow({ where: { id: teamId } })).memberCount).toBe(4);
});

test("wrong, malformed, revoked and expired codes → the same 404 INVALID_CODE", async () => {
  const hackathon = await createHackathon(4);
  const [l1, l2, l3, me] = await registeredUsers(hackathon.id, 4, "bad");
  const revoked = await createWithCode(hackathon.slug, l1!, "APPROVAL", "PUBLIC");
  expect(
    (await api("DELETE", `/api/teams/${revoked.teamId}/invite-code`, { cookie: l1!.cookie }))
      .status,
  ).toBe(200);
  const expired = await createWithCode(hackathon.slug, l2!, "OPEN", "PUBLIC");
  // Move the code's whole life into the past (expires_at must stay after created_at).
  await db.$executeRaw`
    UPDATE invite_codes SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day'
    WHERE team_id = ${expired.teamId}::uuid`;
  await createWithCode(hackathon.slug, l3!, "OPEN", "PUBLIC"); // a valid code exists, just not these

  const answers: Awaited<ReturnType<typeof redeem>>[] = [];
  for (const code of ["ZZZZZZZZZZ", "short", "!!!!!!!!!!", revoked.code, expired.code]) {
    answers.push(await redeem(me!, code));
  }

  for (const res of answers) {
    expect([res.status, res.error?.code]).toEqual([404, "INVALID_CODE"]);
  }
  // Identical messages too: nothing tells a guesser "this one existed once".
  expect(new Set(answers.map((r) => r.error?.message)).size).toBe(1);
  expect(await db.joinRequest.count()).toBe(0);
});

test("a valid code still follows the team's rules: full → TEAM_FULL, in a team → ALREADY_IN_TEAM", async () => {
  const hackathon = await createHackathon(2);
  const [leader, first, second, otherLeader] = await registeredUsers(hackathon.id, 4, "rules");
  const { code } = await createWithCode(hackathon.slug, leader!, "OPEN", "PUBLIC");
  const other = await createWithCode(hackathon.slug, otherLeader!, "OPEN", "PUBLIC");
  expect((await redeem(first!, code)).status).toBe(200); // now full (2/2)

  const full = await redeem(second!, code);
  const inTeam = await redeem(first!, other.code);

  expect([full.status, full.error?.code]).toEqual([409, "TEAM_FULL"]);
  expect([inTeam.status, inTeam.error?.code]).toEqual([409, "ALREADY_IN_TEAM"]);
});

test("body must be { code }: missing or extra fields → 400", async () => {
  const hackathon = await createHackathon(4);
  const [me] = await registeredUsers(hackathon.id, 1, "body");

  for (const body of [{}, { code: 12345 }, { code: "ABCDEFGHJK", teamId: "x" }]) {
    const res = await api("POST", "/api/invites/redeem", { cookie: me!.cookie, body });
    expect([res.status, res.error?.code]).toEqual([400, "VALIDATION_FAILED"]);
  }
});
