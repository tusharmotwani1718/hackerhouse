// Hackathons (admin create, list, detail), the board (listed teams only: looking AND not full),
// All Teams, and the team page. Filters and keyset pagination (05 §3).
import { expect, test } from "bun:test";

import { db } from "../config/db";
import { api } from "../config/http";
import {
  createAdmin,
  createHackathon,
  createTeam,
  createUsers,
  registeredUsers,
  type Registered,
} from "../config/seed";
import { withTestApp } from "../config/suite";

withTestApp();

// ------------------------------------------------------------------------------- hackathons

test("admin creates a hackathon → 201, slug from the name; anyone signed in can read it", async () => {
  const admin = await createAdmin();
  const [user] = await createUsers(1, "reader");

  const res = await api("POST", "/api/hackathons", {
    cookie: admin.cookie,
    body: { name: "Winter Build 2026", minTeamSize: 2, maxTeamSize: 4 },
  });

  expect(res.status).toBe(201);
  expect(res.data).toMatchObject({ slug: "winter-build-2026", minTeamSize: 2, maxTeamSize: 4 });
  const bySlug = await api("GET", `/api/hackathons/winter-build-2026`, { cookie: user!.cookie });
  const byId = await api("GET", `/api/hackathons/${res.data.id}`, { cookie: user!.cookie });
  const upper = await api("GET", `/api/hackathons/WINTER-BUILD-2026`, { cookie: user!.cookie });
  for (const r of [bySlug, byId, upper]) {
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ id: res.data.id, stats: { participants: 0, teams: 0 } });
  }
  const list = await api("GET", "/api/hackathons", { cookie: user!.cookie });
  expect(list.data.map((h: { id: string }) => h.id)).toEqual([res.data.id]);
});

test("hackathon create refused: not admin → 403, slug taken → 409, min > max → 400", async () => {
  const admin = await createAdmin();
  const [user] = await createUsers(1, "notadmin");
  const body = { name: "Spring Jam", minTeamSize: 1, maxTeamSize: 4 };

  const asUser = await api("POST", "/api/hackathons", { cookie: user!.cookie, body });
  const first = await api("POST", "/api/hackathons", { cookie: admin.cookie, body });
  const taken = await api("POST", "/api/hackathons", { cookie: admin.cookie, body });
  const sizes = await api("POST", "/api/hackathons", {
    cookie: admin.cookie,
    body: { name: "Bad Sizes", minTeamSize: 5, maxTeamSize: 2 },
  });

  expect([asUser.status, asUser.error?.code]).toEqual([403, "FORBIDDEN"]);
  expect(first.status).toBe(201);
  expect([taken.status, taken.error?.code]).toEqual([409, "SLUG_TAKEN"]);
  expect([sizes.status, sizes.error?.code]).toEqual([400, "VALIDATION_FAILED"]);
  expect(await db.hackathon.count()).toBe(1);
});

test("hackathon stats count participants, teams and listed teams", async () => {
  const hackathon = await createHackathon(2);
  const [a, b, c, d] = await registeredUsers(hackathon.id, 4, "stats");
  await createTeam({
    hackathonId: hackathon.id,
    maxSize: 2,
    memberParticipantIds: [a!.participantId],
  });
  await createTeam({
    hackathonId: hackathon.id,
    maxSize: 2,
    memberParticipantIds: [b!.participantId, c!.participantId], // full → not listed
  });

  const res = await api("GET", `/api/hackathons/${hackathon.slug}`, { cookie: d!.cookie });

  expect(res.data.stats).toEqual({ participants: 4, teams: 2, lookingTeams: 1 });
});

// ------------------------------------------------------------------------------------ board

/** One team per spec, created in this order (so newest first = reverse order). */
async function boardFixture() {
  const hackathon = await createHackathon(3);
  const people = await registeredUsers(hackathon.id, 12, "board");
  let i = 0;
  const team = async (
    name: string,
    opts: {
      members?: number;
      joinPolicy?: "OPEN" | "APPROVAL";
      access?: "PUBLIC" | "INVITE_ONLY";
      isLooking?: boolean;
    } = {},
  ) => {
    const members: Registered[] = people.slice(i, i + (opts.members ?? 1));
    i += members.length;
    const t = await createTeam({
      hackathonId: hackathon.id,
      maxSize: 3,
      memberParticipantIds: members.map((m) => m.participantId),
      name,
      joinPolicy: opts.joinPolicy,
      access: opts.access,
      isLooking: opts.isLooking,
    });
    // Distinct creation times, oldest first: the order is then certain.
    await db.team.update({
      where: { id: t.id },
      data: { createdAt: new Date(Date.now() - (100 - i) * 1000) },
    });
    return t;
  };
  const alpha = await team("Alpha Open");
  const beta = await team("Beta Approval", { joinPolicy: "APPROVAL" });
  const gamma = await team("Gamma Invite", { access: "INVITE_ONLY" });
  const full = await team("Delta Full", { members: 3 });
  const quiet = await team("Echo Quiet", { isLooking: false });
  const viewer = people.at(-1)!;
  return { hackathon, alpha, beta, gamma, full, quiet, viewer };
}

const names = (res: { data: { teams: { name: string }[] } }) => res.data.teams.map((t) => t.name);

test("board: only listed teams (looking AND not full), newest first, with totalCount", async () => {
  const { hackathon, viewer } = await boardFixture();

  const res = await api("GET", `/api/hackathons/${hackathon.slug}/board`, {
    cookie: viewer.cookie,
  });

  expect(res.status).toBe(200);
  expect(names(res)).toEqual(["Gamma Invite", "Beta Approval", "Alpha Open"]);
  expect(res.data.totalCount).toBe(3);
  expect(res.nextCursor).toBeNull();
  // A card: public info only.
  const card = res.data.teams[2];
  expect(card).toMatchObject({
    memberCount: 1,
    maxSize: 3,
    seatsLeft: 2,
    listed: true,
    skillProfile: { BACKEND: 3 },
  });
  expect(card.leader.name).toBeString();
  expect(JSON.stringify(res.data)).not.toContain("@test.local");
});

test("board filters: policy, access, name search (case-insensitive)", async () => {
  const { hackathon, viewer } = await boardFixture();
  const board = (query: string) =>
    api("GET", `/api/hackathons/${hackathon.slug}/board?${query}`, { cookie: viewer.cookie });

  expect(names(await board("policy=APPROVAL"))).toEqual(["Beta Approval"]);
  expect(names(await board("access=INVITE_ONLY"))).toEqual(["Gamma Invite"]);
  expect(names(await board("policy=OPEN&access=PUBLIC"))).toEqual(["Alpha Open"]);
  expect(names(await board("q=ALPHA"))).toEqual(["Alpha Open"]);
  const filtered = await board("policy=OPEN");
  expect(filtered.data.totalCount).toBe(2); // the count follows the filters
  // Full and not-looking teams never show, whatever the search.
  expect(names(await board("q=Delta"))).toEqual([]);
  expect(names(await board("q=Echo"))).toEqual([]);
});

test("board pagination: pages don't overlap or skip; bad params → 400", async () => {
  const { hackathon, viewer } = await boardFixture();
  const url = `/api/hackathons/${hackathon.slug}/board`;

  const p1 = await api("GET", `${url}?limit=2`, { cookie: viewer.cookie });
  const p2 = await api("GET", `${url}?limit=2&cursor=${encodeURIComponent(p1.nextCursor!)}`, {
    cookie: viewer.cookie,
  });

  expect(names(p1)).toEqual(["Gamma Invite", "Beta Approval"]);
  expect(names(p2)).toEqual(["Alpha Open"]);
  expect(p2.nextCursor).toBeNull();
  expect(p2.data.totalCount).toBe(3);

  for (const query of ["limit=0", "limit=51", "limit=abc", "policy=ANY", "cursor=garbage"]) {
    const res = await api("GET", `${url}?${query}`, { cookie: viewer.cookie });
    expect([res.status, res.error?.code], query).toEqual([400, "VALIDATION_FAILED"]);
  }
});

test("All Teams: every team, full and not-looking ones too", async () => {
  const { hackathon, viewer } = await boardFixture();

  const res = await api("GET", `/api/hackathons/${hackathon.slug}/teams`, {
    cookie: viewer.cookie,
  });

  expect(names(res)).toEqual([
    "Echo Quiet",
    "Delta Full",
    "Gamma Invite",
    "Beta Approval",
    "Alpha Open",
  ]);
  const full = res.data.teams.find((t: { name: string }) => t.name === "Delta Full");
  expect(full).toMatchObject({ seatsLeft: 0, listed: false });
});

// --------------------------------------------------------------------------------- team page

test("team page: members in join order, viewer block; no emails or user ids", async () => {
  const hackathon = await createHackathon(4);
  const [leader, member, outsider] = await registeredUsers(hackathon.id, 3, "page");
  const team = await createTeam({
    hackathonId: hackathon.id,
    maxSize: 4,
    memberParticipantIds: [leader!.participantId, member!.participantId],
    joinPolicy: "APPROVAL",
  });
  await api("POST", `/api/teams/${team.id}/requests`, { cookie: outsider!.cookie });

  const asLeader = await api("GET", `/api/teams/${team.id}`, { cookie: leader!.cookie });
  const asOutsider = await api("GET", `/api/teams/${team.id}`, { cookie: outsider!.cookie });

  expect(asLeader.status).toBe(200);
  expect(asLeader.data.members.map((m: { participantId: string }) => m.participantId)).toEqual([
    leader!.participantId,
    member!.participantId,
  ]);
  expect(asLeader.data.viewer).toMatchObject({ isMember: true, isLeader: true, myRequest: null });
  expect(asOutsider.data.viewer).toMatchObject({
    isMember: false,
    isLeader: false,
    myRequest: { status: "PENDING" },
  });
  const text = JSON.stringify(asOutsider.data);
  expect(text).not.toContain("@test.local");
  for (const u of [leader!, member!]) expect(text).not.toContain(u.id);

  const missing = await api("GET", "/api/teams/not-a-team", { cookie: outsider!.cookie });
  expect([missing.status, missing.error?.code]).toEqual([404, "TEAM_NOT_FOUND"]);
});
