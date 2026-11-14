// Who may see what: the team audit log (current leader + admins, R29), the admin's deleted-teams
// list, and teammate suggestions (leader only, step 8.1).
import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import { db } from "../config/db";
import { api } from "../config/http";
import { createAdmin, createHackathon, createTeam, registeredUsers } from "../config/seed";
import { withTestApp } from "../config/suite";

withTestApp();

// ---------------------------------------------------------------------------------- audit log

test("audit: leader sees curated entries, admin also the raw fields; others 403", async () => {
  const admin = await createAdmin();
  const hackathon = await createHackathon(4);
  const [leader, member, outsider] = await registeredUsers(hackathon.id, 3, "audit");
  const created = await api("POST", `/api/hackathons/${hackathon.slug}/teams`, {
    cookie: leader!.cookie,
    body: { name: "Logged Team", joinPolicy: "OPEN", access: "PUBLIC" },
  });
  const teamId = created.data.team.id;
  await api("POST", `/api/teams/${teamId}/join`, { cookie: member!.cookie });
  const url = `/api/teams/${teamId}/audit`;

  const asLeader = await api("GET", url, { cookie: leader!.cookie });
  const asAdmin = await api("GET", url, { cookie: admin.cookie });
  const asMember = await api("GET", url, { cookie: member!.cookie });
  const asOutsider = await api("GET", url, { cookie: outsider!.cookie });

  expect(asLeader.status).toBe(200);
  // Newest first.
  expect(asLeader.data.entries.map((e: { action: string }) => e.action)).toEqual([
    "MEMBER_JOINED",
    "INVITE_CODE_GENERATED",
    "TEAM_CREATED",
  ]);
  const leaderEntry = asLeader.data.entries[0];
  expect(leaderEntry.actor).toMatchObject({ name: expect.any(String) });
  expect(leaderEntry).not.toHaveProperty("actorUserId");
  expect(leaderEntry).not.toHaveProperty("metadata");
  expect(asAdmin.data.entries[0]).toMatchObject({
    actorUserId: member!.id,
    metadata: expect.any(Object),
  });
  expect([asMember.status, asMember.error?.code]).toEqual([403, "NOT_LEADER"]);
  expect([asOutsider.status, asOutsider.error?.code]).toEqual([403, "NOT_LEADER"]);
});

test("audit: categories filter, pages are exact", async () => {
  const hackathon = await createHackathon(4);
  const [leader, asker] = await registeredUsers(hackathon.id, 2, "cat");
  const created = await api("POST", `/api/hackathons/${hackathon.slug}/teams`, {
    cookie: leader!.cookie,
    body: { name: "Category Team", joinPolicy: "APPROVAL", access: "PUBLIC" },
  });
  const teamId = created.data.team.id;
  await api("POST", `/api/teams/${teamId}/requests`, { cookie: asker!.cookie });
  await api("DELETE", `/api/teams/${teamId}/invite-code`, { cookie: leader!.cookie });
  const get = (query: string) =>
    api("GET", `/api/teams/${teamId}/audit?${query}`, { cookie: leader!.cookie });
  const actions = (res: { data: { entries: { action: string }[] } }) =>
    res.data.entries.map((e) => e.action);

  expect(actions(await get("category=team"))).toEqual(["TEAM_CREATED"]);
  expect(actions(await get("category=requests"))).toEqual(["REQUEST_CREATED"]);
  expect(actions(await get("category=invites"))).toEqual([
    "INVITE_CODE_REVOKED",
    "INVITE_CODE_GENERATED",
  ]);

  const p1 = await get("limit=2");
  const p2 = await get(`limit=2&cursor=${encodeURIComponent(p1.nextCursor!)}`);
  expect([...actions(p1), ...actions(p2)]).toEqual([
    "INVITE_CODE_REVOKED",
    "REQUEST_CREATED",
    "INVITE_CODE_GENERATED",
    "TEAM_CREATED",
  ]);
  expect(p2.nextCursor).toBeNull();
  const bad = await get("category=everything");
  expect([bad.status, bad.error?.code]).toEqual([400, "VALIDATION_FAILED"]);
});

test("audit follows leadership: the former leader loses access, the new one gains it", async () => {
  const hackathon = await createHackathon(4);
  const [leader, next] = await registeredUsers(hackathon.id, 2, "succession");
  const team = await createTeam({
    hackathonId: hackathon.id,
    maxSize: 4,
    memberParticipantIds: [leader!.participantId, next!.participantId],
  });
  const url = `/api/teams/${team.id}/audit`;
  expect((await api("GET", url, { cookie: leader!.cookie })).status).toBe(200);

  await api("POST", `/api/teams/${team.id}/leave`, { cookie: leader!.cookie });

  expect((await api("GET", url, { cookie: leader!.cookie })).status).toBe(403);
  expect((await api("GET", url, { cookie: next!.cookie })).status).toBe(200);
});

test("deleted teams: only admins read them, and can open their full history", async () => {
  const admin = await createAdmin();
  const hackathon = await createHackathon(4);
  const [leader] = await registeredUsers(hackathon.id, 1, "gone");
  const created = await api("POST", `/api/hackathons/${hackathon.slug}/teams`, {
    cookie: leader!.cookie,
    body: { name: "Gone Team", joinPolicy: "OPEN", access: "PUBLIC" },
  });
  const teamId = created.data.team.id;
  await api("POST", `/api/teams/${teamId}/leave`, { cookie: leader!.cookie }); // deleted (case A)
  const listUrl = `/api/admin/hackathons/${hackathon.slug}/deleted-teams`;

  const list = await api("GET", listUrl, { cookie: admin.cookie });
  const asUser = await api("GET", listUrl, { cookie: leader!.cookie });

  expect(list.status).toBe(200);
  expect(list.data.teams).toHaveLength(1);
  expect(list.data.teams[0]).toMatchObject({
    teamId,
    name: "Gone Team",
    reason: "LAST_MEMBER_LEFT",
  });
  expect([asUser.status, asUser.error?.code]).toEqual([403, "FORBIDDEN"]);

  const history = await api("GET", `/api/teams/${teamId}/audit`, { cookie: admin.cookie });
  expect(history.status).toBe(200);
  expect(history.data.entries[0].action).toBe("TEAM_DELETED");
  // The former leader: the team is gone, so it's simply not found.
  const asFormer = await api("GET", `/api/teams/${teamId}/audit`, { cookie: leader!.cookie });
  expect(asFormer.status).toBe(404);
  const unknown = await api("GET", `/api/teams/${randomUUID()}/audit`, { cookie: admin.cookie });
  expect(unknown.status).toBe(404);
});

// -------------------------------------------------------------------------------- suggestions

test("suggestions: gap fillers rank first; members never listed; requesters flagged", async () => {
  const hackathon = await createHackathon(4);
  const [leader, member, redundant, gapFiller, asker] = await registeredUsers(
    hackathon.id,
    5,
    "sugg",
  );
  // Everyone starts with BACKEND 3 (completeProfiles). Give the gap filler a skill the team lacks.
  await db.userSkill.create({ data: { userId: gapFiller!.id, skill: "AI_ML", level: 4 } });
  const team = await createTeam({
    hackathonId: hackathon.id,
    maxSize: 4,
    memberParticipantIds: [leader!.participantId, member!.participantId],
    joinPolicy: "APPROVAL",
  });
  await api("POST", `/api/teams/${team.id}/requests`, { cookie: asker!.cookie });

  const res = await api("GET", `/api/teams/${team.id}/suggestions?limit=10`, {
    cookie: leader!.cookie,
  });

  expect(res.status).toBe(200);
  const ids = res.data.suggestions.map((s: { participant: { id: string } }) => s.participant.id);
  expect(ids[0]).toBe(gapFiller!.participantId);
  expect(ids).toContain(redundant!.participantId); // zero-score candidates are listed, last
  expect(ids).not.toContain(member!.participantId);
  expect(ids).not.toContain(leader!.participantId);
  const top = res.data.suggestions[0];
  expect(top.score).toBeGreaterThan(0);
  expect(top.breakdown.skills.find((s: { skill: string }) => s.skill === "AI_ML")).toMatchObject({
    teamLevel: 0,
    candidateLevel: 4,
  });
  const flagged = res.data.suggestions.find(
    (s: { participant: { id: string } }) => s.participant.id === asker!.participantId,
  );
  expect(flagged.hasRequestedYourTeam).toBe(true);
});

test("suggestions refused: member → 403, full team → 409 TEAM_FULL, bad limit → 400", async () => {
  const hackathon = await createHackathon(2);
  const [leader, member, lone] = await registeredUsers(hackathon.id, 3, "suggno");
  const full = await createTeam({
    hackathonId: hackathon.id,
    maxSize: 2,
    memberParticipantIds: [leader!.participantId, member!.participantId],
  });
  const open = await createTeam({
    hackathonId: hackathon.id,
    maxSize: 2,
    memberParticipantIds: [lone!.participantId],
  });

  const asMember = await api("GET", `/api/teams/${full.id}/suggestions`, {
    cookie: member!.cookie,
  });
  const whenFull = await api("GET", `/api/teams/${full.id}/suggestions`, {
    cookie: leader!.cookie,
  });
  const badLimit = await api("GET", `/api/teams/${open.id}/suggestions?limit=51`, {
    cookie: lone!.cookie,
  });

  expect([asMember.status, asMember.error?.code]).toEqual([403, "NOT_LEADER"]);
  expect([whenFull.status, whenFull.error?.code]).toEqual([409, "TEAM_FULL"]);
  expect([badLimit.status, badLimit.error?.code]).toEqual([400, "VALIDATION_FAILED"]);
});
