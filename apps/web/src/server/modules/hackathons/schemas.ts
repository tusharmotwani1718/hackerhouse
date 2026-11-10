import "server-only";

import { z } from "zod";

/** Lowercase letters/digits with single hyphens between them. Same rule as the DB CHECK. */
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const SLUG_MIN = 3;
export const SLUG_MAX = 60;
/** 02 §3.2: 1 ≤ min ≤ max ≤ 10. */
export const TEAM_SIZE_MAX = 10;

/** "HackFest 2026!" → "hackfest-2026", "Café Ünïcode" → "cafe-unicode". May come out too short. */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // drop accents left over by NFKD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/, ""); // the cut may end on a hyphen
}

const name = z
  .string({ error: "must be a string" })
  .trim()
  .min(3, { error: "must be 3-100 characters" })
  .max(100, { error: "must be 3-100 characters" });

const slug = z
  .string({ error: "must be a string" })
  .trim()
  .toLowerCase()
  .min(SLUG_MIN, { error: `must be ${SLUG_MIN}-${SLUG_MAX} characters` })
  .max(SLUG_MAX, { error: `must be ${SLUG_MIN}-${SLUG_MAX} characters` })
  .regex(SLUG, {
    error: "may contain only letters, digits and single hyphens, not at the start or end",
  });

const description = z
  .string({ error: "must be a string" })
  .trim()
  .max(5000, { error: "must be at most 5000 characters" });

const teamSize = z
  .number({ error: `must be a whole number 1-${TEAM_SIZE_MAX}` })
  .int({ error: `must be a whole number 1-${TEAM_SIZE_MAX}` })
  .min(1, { error: `must be 1-${TEAM_SIZE_MAX}` })
  .max(TEAM_SIZE_MAX, { error: `must be 1-${TEAM_SIZE_MAX}` });

/**
 * POST /api/hackathons body. Unknown fields are rejected. `slug` defaults to slugify(name);
 * sizes are fixed forever once created (R10), so double-check them before sending.
 */
export const createHackathonSchema = z
  .strictObject({
    name,
    slug: slug.optional(),
    description: description.default(""),
    minTeamSize: teamSize,
    maxTeamSize: teamSize,
  })
  .refine((body) => body.minTeamSize <= body.maxTeamSize, {
    path: ["maxTeamSize"],
    error: "must be at least minTeamSize",
  })
  .transform((body, ctx) => {
    const finalSlug = body.slug ?? slugify(body.name);
    if (finalSlug.length < SLUG_MIN) {
      ctx.addIssue({
        code: "custom",
        path: ["slug"],
        message: `could not derive a slug from the name; please provide one (${SLUG_MIN}-${SLUG_MAX} characters)`,
      });
      return z.NEVER;
    }
    return { ...body, slug: finalSlug };
  });

export type CreateHackathon = z.output<typeof createHackathonSchema>;
