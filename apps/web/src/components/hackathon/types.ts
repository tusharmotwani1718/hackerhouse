import type { JoinPolicy, TeamAccess } from "@/components/board/types";

/** "My team" tab (client-safe; dates as ISO strings). */
export type MyTeamView = {
  id: string;
  name: string;
  description: string;
  joinPolicy: JoinPolicy;
  access: TeamAccess;
  memberCount: number;
  maxSize: number;
  seatsLeft: number;
  /** Shown on the board (looking for members and not full). */
  listed: boolean;
  isLeader: boolean;
  createdAt: string;
  members: {
    participantId: string;
    name: string;
    githubUsername: string | null;
    portfolioUrl: string | null;
    skills: Partial<Record<string, number>>;
    joinedAt: string;
    isLeader: boolean;
  }[];
  /** The active invite code (members only), or null when none is active. */
  invite: { code: string; expiresAt: string } | null;
  /** Leader of an APPROVAL team: the PENDING requests (first page); otherwise null. */
  inbox: { requests: InboxRequestView[]; totalCount: number; nextCursor: string | null } | null;
};

export type RequestStatus = "PENDING" | "APPROVED" | "DECLINED" | "CANCELLED";

/** One request in the leader's inbox (GET /api/teams/{id}/requests item, dates as strings). */
export type InboxRequestView = {
  id: string;
  status: RequestStatus;
  declineReason: "LEADER" | "TEAM_FULL" | null;
  createdAt: string;
  decidedAt: string | null;
  requester: {
    name: string;
    githubUsername: string | null;
    portfolioUrl: string | null;
    timezone: string;
    skills: Partial<Record<string, number>>;
  };
};

/** One row of the "My requests" tab (also the API's item shape, minus unused fields). */
export type MyRequestView = {
  id: string;
  status: "PENDING" | "APPROVED" | "DECLINED" | "CANCELLED";
  declineReason: "LEADER" | "TEAM_FULL" | null;
  createdAt: string;
  decidedAt: string | null;
  team: {
    name: string;
    joinPolicy: JoinPolicy;
    access: TeamAccess;
    memberCount: number;
    maxSize: number;
  };
};

/** Fixed format and time zone, so server and browser render the same text. */
export const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
