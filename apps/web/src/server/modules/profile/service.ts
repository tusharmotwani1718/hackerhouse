import "server-only";

import type { Skill } from "@hacker-house/db";

import { AppError } from "../../core/errors";
import type { Tx } from "../../core/tx";
import type { ProfilePatch } from "./schemas";

export type Profile = {
  id: string;
  name: string;
  email: string;
  role: "USER" | "ADMIN";
  timezone: string;
  githubUsername: string | null;
  /** Always false in v1; derived from a linked GitHub account later (04 §1.3). */
  githubVerified: false;
  portfolioUrl: string | null;
  skills: Partial<Record<Skill, number>>;
  profileComplete: boolean;
  missing: ("githubUsername" | "skills")[];
};

/** 04 §1.2: complete = GitHub username + at least one skill. Required to register (Flow 5). */
export function missingForCompleteProfile(
  githubUsername: string | null,
  skillCount: number,
): Profile["missing"] {
  const missing: Profile["missing"] = [];
  if (!githubUsername) missing.push("githubUsername");
  if (skillCount === 0) missing.push("skills");
  return missing;
}

export async function getProfile(tx: Tx, userId: string): Promise<Profile> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      timezone: true,
      githubUsername: true,
      portfolioUrl: true,
      skills: { select: { skill: true, level: true }, orderBy: { skill: "asc" } },
    },
  });
  // The session was valid a moment ago; a missing row means the user was deleted meanwhile.
  if (!user) throw new AppError("UNAUTHENTICATED", "Please sign in to continue.");

  const missing = missingForCompleteProfile(user.githubUsername, user.skills.length);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    timezone: user.timezone,
    githubUsername: user.githubUsername,
    githubVerified: false,
    portfolioUrl: user.portfolioUrl,
    skills: Object.fromEntries(user.skills.map((s) => [s.skill, s.level])),
    profileComplete: missing.length === 0,
    missing,
  };
}

/**
 * Apply a validated patch. Runs inside runTx.
 *
 * Locks the user row FIRST (lock order I1: user → …). Without it, two concurrent skill
 * replacements interleave under READ COMMITTED: the second DELETE waits on the rows the first
 * deleted, then cannot see the rows the first inserted (its snapshot predates them), so it
 * leaves them in place and adds its own → a mix of both sets, or a primary-key error.
 */
export async function updateProfile(tx: Tx, userId: string, patch: ProfilePatch): Promise<Profile> {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;

  const { skills, ...fields } = patch;
  if (Object.keys(fields).length > 0) {
    await tx.user.update({ where: { id: userId }, data: fields });
  }

  if (skills) {
    await tx.userSkill.deleteMany({ where: { userId } });
    const rows = Object.entries(skills)
      .filter(([, level]) => (level ?? 0) >= 1) // level 0 = no row
      .map(([skill, level]) => ({ userId, skill: skill as Skill, level: level! }));
    await tx.userSkill.createMany({ data: rows });
  }

  return getProfile(tx, userId);
}
