import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";

import { db, migrateTestDb, resetDb } from "../config/db";
import { assertTestDatabase } from "../config/env";
import { allOverlapped, joinTeam, timingSummary } from "../config/http";
import { createHackathon, createTeam, createUsers, registerAll } from "../config/seed";
import { startApp } from "../config/server";
import { randomUUID } from "node:crypto";

let stopApp: (() => Promise<void>) | undefined;

beforeAll(async () => {
  assertTestDatabase(); // FIRST: never touch a non-test database
  migrateTestDb();
  await resetDb();
  stopApp = await startApp();
}, 120_000);

afterAll(async () => {
  await stopApp?.();
  await db.$disconnect();
});

beforeEach(async () => {
  await resetDb(); // every scenario starts from an empty database
});

/** Open the app's pool connections before the race, so the race measures locks, not connects. */
async function warmUp(cookie: string) {
  await Promise.all(
    Array.from({ length: 10 }, () =>
      fetch("http://localhost:3100/api/hackathons", { headers: { cookie } }),
    ),
  );
}

test("50 joiners, 1 free seat → exactly one wins, the rest get TEAM_FULL", async () => {
  // Arrange: a team of 3 in a hackathon of max 4 → exactly ONE seat left; 50 registered joiners.
  const hackathon = await createHackathon(4);
  const members = await createUsers(3, "member");
  const joiners = await createUsers(50, "joiner");
  const memberParticipants = await registerAll(hackathon.id, members);
  await registerAll(hackathon.id, joiners);
  const team = await createTeam({
    hackathonId: hackathon.id,
    maxSize: 4,
    memberParticipantIds: memberParticipants.map((p) => p.id),
  });
  await warmUp(joiners[0]!.cookie);

  // Act: all 50 at once.
  const results = await Promise.all(joiners.map((j) => joinTeam(j.cookie, team.id)));
  console.log(`50→1 race: ${timingSummary(results)}`);

  // 1. It really raced.
  expect(allOverlapped(results)).toBe(true);

  // 2. Responses: exactly one winner, everyone else TEAM_FULL, nothing else at all.
  const winners = results.filter((r) => r.status === 200);
  const full = results.filter((r) => r.status === 409 && r.code === "TEAM_FULL");
  expect(winners).toHaveLength(1);
  expect(full).toHaveLength(49);

  // 3. Database: consistent with the responses.
  const after = await db.team.findUniqueOrThrow({
    where: { id: team.id },
    select: { memberCount: true, version: true },
  });
  expect(after.memberCount).toBe(4);
  expect(await db.participant.count({ where: { teamId: team.id } })).toBe(4);
  expect(after.version).toBe(2); // seeded at 1, changed exactly once
  expect(await db.auditLog.count({ where: { teamId: team.id, action: "MEMBER_JOINED" } })).toBe(1);
}, 60_000);

test("one user joins two teams at once → exactly one join (10 rounds)", async () => {
  for (let round = 0; round < 10; round++) {
    await resetDb();
    const hackathon = await createHackathon(4);
    const [leaderA, leaderB, joiner] = await createUsers(3, `r${round}`);
    const [pA, pB] = await registerAll(hackathon.id, [leaderA!, leaderB!]);
    await registerAll(hackathon.id, [joiner!]);
    const teamA = await createTeam({ hackathonId: hackathon.id, maxSize: 4, memberParticipantIds: [pA!.id] });
    const teamB = await createTeam({ hackathonId: hackathon.id, maxSize: 4, memberParticipantIds: [pB!.id] });

    const results = await Promise.all([
      joinTeam(joiner!.cookie, teamA.id),
      joinTeam(joiner!.cookie, teamB.id),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.code).toBe("ALREADY_IN_TEAM");
    const counts = await db.team.findMany({
      where: { id: { in: [teamA.id, teamB.id] } },
      select: { memberCount: true },
    });
    expect(counts.reduce((sum, t) => sum + t.memberCount, 0)).toBe(3); // 1 + 1 + exactly one join
  }
}, 60_000);

test("same key sent 50 times → one join, 49 identical replays", async () => {
  const hackathon = await createHackathon(4);
  const [leader, joiner] = await createUsers(2, "key");
  const [pLeader] = await registerAll(hackathon.id, [leader!]);
  await registerAll(hackathon.id, [joiner!]);
  const team = await createTeam({ hackathonId: hackathon.id, maxSize: 4, memberParticipantIds: [pLeader!.id] });

  const key = randomUUID();
  const results = await Promise.all(
    Array.from({ length: 50 }, () => joinTeam(joiner!.cookie, team.id, key)),
  );

  expect(results.every((r) => r.status === 200)).toBe(true);
  expect(new Set(results.map((r) => JSON.stringify(r.body))).size).toBe(1); // identical bodies
  expect(results.filter((r) => r.replayed)).toHaveLength(49);
  const after = await db.team.findUniqueOrThrow({ where: { id: team.id }, select: { memberCount: true } });
  expect(after.memberCount).toBe(2);
  expect(await db.idempotencyKey.count({ where: { key } })).toBe(1);
}, 60_000);


