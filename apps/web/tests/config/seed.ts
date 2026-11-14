import { createHmac, randomBytes } from "node:crypto";

import { db } from "./db";
import { AUTH_SECRET } from "./env";

export type TestUser = { id: string; email: string; cookie: string };

/**
 * The cookie Better Auth's getSession accepts (verified in spike S6 and against
 * better-call 1.4.4's signCookieValue):
 *   name  better-auth.session_token   (plain name because BETTER_AUTH_URL is http://)
 *   value encodeURIComponent(token + "." + base64(HMAC-SHA256(secret, token)))
 */
export function sessionCookie(token: string): string {
  const signature = createHmac("sha256", AUTH_SECRET).update(token).digest("base64");
  return `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
}

/** `count` users, each with a live session and its signed cookie: no HTTP sign-in needed. */
export async function createUsers(count: number, prefix: string): Promise<TestUser[]> {
  const users = await db.user.createManyAndReturn({
    data: Array.from({ length: count }, (_, i) => ({
      name: `${prefix} ${i}`,
      email: `${prefix}-${i}@test.local`, // lowercase, like Better Auth stores them
    })),
    select: { id: true, email: true },
  });

  const tokens = users.map(() => randomBytes(24).toString("hex"));
  await db.session.createMany({
    data: users.map((user, i) => ({
      userId: user.id,
      token: tokens[i]!,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour is plenty for a test
    })),
  });

  return users.map((user, i) => ({ ...user, cookie: sessionCookie(tokens[i]!) }));
}

export async function createHackathon(maxTeamSize: number) {
  // A unique prefix: emails are UNIQUE, and a test may create more than one hackathon.
  const [creator] = await createUsers(1, `admin-${randomBytes(3).toString("hex")}`);
  return db.hackathon.create({
    data: {
      name: "Race Hackathon",
      slug: `race-${randomBytes(4).toString("hex")}`,
      minTeamSize: 1,
      maxTeamSize,
      createdByUserId: creator!.id,
    },
  });
}

/** Register users in a hackathon (direct inserts: registration isn't what we're testing). */
export async function registerAll(hackathonId: string, users: TestUser[]) {
  return db.participant.createManyAndReturn({
    data: users.map((user) => ({ userId: user.id, hackathonId })),
    select: { id: true, userId: true },
  });
}

/**
 * A team whose members are the given participants (the first one leads). One transaction,
 * because the leader FK is DEFERRED: the team names its leader before the leader's team_id
 * is set, and Postgres checks the pair only at COMMIT, the same as the real create flow.
 */
export async function createTeam(input: {
  hackathonId: string;
  maxSize: number; // must equal the hackathon's max (teams_hackathon_fkey enforces it)
  memberParticipantIds: string[];
  name?: string;
}) {
  return db.$transaction(async (tx) => {
    const team = await tx.team.create({
      data: {
        hackathonId: input.hackathonId,
        name: input.name ?? `Team ${randomBytes(3).toString("hex")}`,
        joinPolicy: "OPEN",
        access: "PUBLIC",
        leaderParticipantId: input.memberParticipantIds[0]!,
        memberCount: input.memberParticipantIds.length,
        maxSize: input.maxSize,
      },
    });
    await tx.participant.updateMany({
      where: { id: { in: input.memberParticipantIds } },
      data: { teamId: team.id, teamJoinedAt: new Date() },
    });
    return team;
  });
}

/** Give users what registration requires: a GitHub username and one skill. */
export async function completeProfiles(users: TestUser[]) {
  for (const u of users) {
    await db.user.update({
      where: { id: u.id },
      data: { githubUsername: `gh-${u.id.slice(0, 8)}` },
    });
  }
  await db.userSkill.createMany({
    data: users.map((u) => ({ userId: u.id, skill: "BACKEND", level: 3 })),
  });
}
