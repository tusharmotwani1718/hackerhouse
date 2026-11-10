import "server-only";

import { CANONICAL_TIMEZONES, TIMEZONE_ALIASES } from "./timezones.data";

// Case-insensitive lookup: "asia/kolkata", "Asia/Calcutta" (what browsers often report) → "Asia/Kolkata".
const byLowercase = new Map<string, string>();
for (const zone of CANONICAL_TIMEZONES) byLowercase.set(zone.toLowerCase(), zone);
for (const [alias, zone] of Object.entries(TIMEZONE_ALIASES)) {
  if (!byLowercase.has(alias.toLowerCase())) byLowercase.set(alias.toLowerCase(), zone);
}

/** The canonical IANA name for `name`, or null if it isn't a known zone. */
export function canonicalTimezone(name: string): string | null {
  return byLowercase.get(name.trim().toLowerCase()) ?? null;
}
