/** Client-safe profile (the shape of GET/PATCH /api/me). */
export type ProfileData = {
  name: string;
  email: string;
  role: "USER" | "ADMIN";
  timezone: string;
  githubUsername: string | null;
  portfolioUrl: string | null;
  skills: Partial<Record<string, number>>;
  profileComplete: boolean;
  missing: ("githubUsername" | "skills")[];
};

/** Skill level rubric (04 §1.1), shown in the skills editor. */
export const LEVELS = [
  { level: 1, label: "Learning", hint: "Tutorials / coursework" },
  { level: 2, label: "Hobbyist", hint: "Built small projects" },
  { level: 3, label: "Practitioner", hint: "Built & shipped real projects" },
  { level: 4, label: "Strong", hint: "Could lead this area on a team" },
  { level: 5, label: "Expert", hint: "Professional / deep experience" },
] as const;

/** Field errors from a VALIDATION_FAILED response: { path, message }[] → { field: text }. */
export function fieldErrors(
  details: unknown,
  labels: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(details)) return out;
  for (const detail of details as { path?: string; message?: string }[]) {
    const field = (detail.path ?? "").split(".")[0] ?? "";
    if (field in labels && !out[field]) out[field] = `${labels[field]} ${detail.message}.`;
  }
  return out;
}
