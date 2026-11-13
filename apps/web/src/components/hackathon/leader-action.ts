"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { api, type ApiResult } from "@/lib/api";

/** Plain-language messages for the leader tools (others fall back to lib/api's wording). */
function leaderMessage(code: string, fallback: string): string {
  switch (code) {
    case "NOT_LEADER":
      return "You're no longer this team's leader.";
    case "TEAM_FULL":
      return "Your team is full: free a seat before showing it on the board.";
    case "NO_ACTIVE_CODE":
      return "There is no active invite code anymore.";
    case "NOT_A_MEMBER":
      return "This person is no longer in your team.";
    default:
      return fallback;
  }
}

/** Codes after which the page is out of date (re-render it from the server). */
const STALE = new Set([
  "NOT_LEADER",
  "NO_ACTIVE_CODE",
  "NOT_A_MEMBER",
  "TEAM_NOT_FOUND",
  "TEAM_FULL",
]);

/**
 * Runs one leader action (toggle, code, remove), then re-renders the page from the server on
 * success, so the summary, invite code, members and seats all update together.
 */
export function useLeaderAction() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run<T>(path: string, options: Parameters<typeof api>[1]): Promise<ApiResult<T>> {
    setPending(true);
    setError(null);
    const result = await api<T>(path, options);
    setPending(false);
    if (result.ok) {
      router.refresh();
    } else {
      setError(leaderMessage(result.code, result.message));
      if (STALE.has(result.code)) router.refresh();
    }
    return result;
  }

  return { run, pending, error, setError };
}
