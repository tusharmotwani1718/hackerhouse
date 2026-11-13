/**
 * Hackathon slug rules, shared by the API (server/modules/hackathons/schemas.ts) and the create
 * form (auto-filled slug), so both always agree. Same rule as the DB CHECK.
 */

/** Lowercase letters/digits with single hyphens between them. */
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const SLUG_MIN = 3;
export const SLUG_MAX = 60;

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
