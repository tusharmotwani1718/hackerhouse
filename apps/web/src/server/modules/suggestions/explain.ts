import "server-only";

import type { Skill } from "@hacker-house/db";

/** The `method` text of every response (04 §4): how the score is computed, in plain words. */
export const SCORING_METHOD =
  "score = skillGain × tzFactor. skillGain sums, per skill, how much the candidate raises the " +
  "team's best level on a diminishing-returns curve (0, .40, .65, .80, .90, 1.00 for levels 0–5): " +
  "filling a gap counts most, matching what the team already has counts nothing. " +
  "tzFactor = 0.5 + 0.5 × (shared hours of a 12-hour working day / 12), using the team's median " +
  "UTC offset today; zones more than 12 hours apart wrap around (UTC+14 and UTC−10 share the " +
  "same clock time).";

/** Display rounding (8.1 C3): the ranking itself uses the exact values. */
export const round2 = (value: number) => Math.round(value * 100) / 100;

/** Hours east of UTC → "UTC+05:30" / "UTC−10:00" / "UTC+00:00". */
export function formatOffset(hours: number): string {
  const sign = hours < 0 ? "−" : "+";
  const totalMinutes = Math.round(Math.abs(hours) * 60);
  const hh = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const mm = String(totalMinutes % 60).padStart(2, "0");
  return `UTC${sign}${hh}:${mm}`;
}

/** Why a skill adds (or doesn't add) to the score, for `breakdown.skills[].reason`. */
export function skillReason(skill: Skill, teamLevel: number, candidateLevel: number): string {
  if (teamLevel === 0) return `Fills a gap: team has no ${skill}`;
  if (candidateLevel > teamLevel) return `Strengthens ${skill} (${teamLevel} → ${candidateLevel})`;
  return `Team already has ${skill} at ${teamLevel}`;
}

/** `breakdown.formula`, e.g. "skillGain (1.15) × tzFactor (1.0) = 1.15". */
export function formula(skillGain: number, tzFactor: number, score: number): string {
  return `skillGain (${round2(skillGain)}) × tzFactor (${round2(tzFactor)}) = ${round2(score)}`;
}
