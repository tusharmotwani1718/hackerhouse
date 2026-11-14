/** Client-safe shapes for the board (the server's TeamCard, with dates as ISO strings). */
export type JoinPolicy = "OPEN" | "APPROVAL";
export type TeamAccess = "PUBLIC" | "INVITE_ONLY";

export type BoardTeam = {
  id: string;
  name: string;
  description: string;
  joinPolicy: JoinPolicy;
  access: TeamAccess;
  memberCount: number;
  maxSize: number;
  seatsLeft: number;
  /** Shown on the board: looking for members AND not full. */
  listed: boolean;
  /** Bumped on every change; a live event replaces the card only if its version is newer. */
  version: number;
  leader: { name: string };
  skillProfile: Partial<Record<string, number>>;
  createdAt: string;
};

/** Filters, kept in the URL: ?q=&show=all&policy=OPEN&access=PUBLIC. */
export type BoardFilters = {
  /** "looking" = the board (looking for members, not full); "all" = every team. */
  show: "looking" | "all";
  q?: string;
  policy?: JoinPolicy;
  access?: TeamAccess;
};

/** The viewer, for the per-team action buttons. */
export type BoardViewer = {
  registered: boolean;
  team: { id: string; name: string } | null;
  /** Teams the viewer has a PENDING request to. */
  pendingTeamIds: string[];
  /** Admins get an "Activity" button on every card (the team's audit log). */
  isAdmin?: boolean;
};

export function filtersToSearch(filters: BoardFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.show === "all") params.set("show", "all");
  if (filters.policy) params.set("policy", filters.policy);
  if (filters.access) params.set("access", filters.access);
  return params;
}
