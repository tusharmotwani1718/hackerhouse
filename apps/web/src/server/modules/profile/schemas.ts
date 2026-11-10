import "server-only";

import { Skill } from "@hacker-house/db";
import { z } from "zod";

import { canonicalTimezone } from "./timezones";

export const SKILLS = Object.values(Skill) as [Skill, ...Skill[]];

/** GitHub's rules: 1–39 chars, letters/digits, single hyphens between them. Stored lowercase. */
export const GITHUB_USERNAME = /^[a-z0-9](-?[a-z0-9])*$/;

const name = z
  .string({ error: "must be a string" })
  .trim()
  .min(1, { error: "must be 1-80 characters" })
  .max(80, { error: "must be 1-80 characters" });

const githubUsername = z
  .string({
    error: (issue) =>
      issue.input === null ? "cannot be cleared once set (04 §1.2)" : "must be a string",
  })
  .trim()
  .transform((value) => value.replace(/^@/, "").toLowerCase())
  .pipe(
    z
      .string()
      .min(1, { error: "is required" })
      .max(39, { error: "must be at most 39 characters" })
      .regex(GITHUB_USERNAME, {
        error: "may contain only letters, digits and single hyphens, not at the start or end",
      }),
  );

const portfolioUrl = z.union(
  [
    z.null(), // clears it
    z
      .string()
      .trim()
      .max(2048, { error: "must be at most 2048 characters" })
      .refine((value) => URL.canParse(value) && new URL(value).protocol === "https:", {
        error: "must be an https:// URL",
      }),
  ],
  { error: "must be an https:// URL or null" },
);

const timezone = z.string({ error: "must be a string" }).transform((value, ctx) => {
  const canonical = canonicalTimezone(value);
  if (!canonical) {
    ctx.addIssue({
      code: "custom",
      message: `unknown timezone "${value}"; use an IANA name such as Asia/Kolkata`,
    });
    return z.NEVER;
  }
  return canonical;
});

/** Full replacement of the skill set. Level 0 = remove; at least one skill must stay ≥ 1. */
const skills = z
  .partialRecord(
    z.enum(SKILLS, { error: `unknown skill; allowed: ${SKILLS.join(", ")}` }),
    z
      .number({ error: "level must be a number 0-5" })
      .int({ error: "level must be a whole number 0-5" })
      .min(0, { error: "level must be 0-5" })
      .max(5, { error: "level must be 0-5 (0 removes the skill)" }),
  )
  .refine((map) => Object.values(map).some((level) => (level ?? 0) >= 1), {
    error: "at least one skill must have level 1-5",
  });

/** PATCH /api/me body. Unknown fields (e.g. `role`, `email`) are rejected, not ignored. */
export const profilePatchSchema = z
  .strictObject({
    name: name.optional(),
    githubUsername: githubUsername.optional(),
    portfolioUrl: portfolioUrl.optional(),
    timezone: timezone.optional(),
    skills: skills.optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { error: "nothing to update" });

export type ProfilePatch = z.output<typeof profilePatchSchema>;
