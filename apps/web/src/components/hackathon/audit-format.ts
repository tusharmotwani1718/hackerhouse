import type { AuditCategory, AuditEntryView } from "./types";

/** Status-chip colours (soft tints of the theme tokens). */
const TONE = {
  good: "bg-accent text-accent-foreground",
  wait: "bg-chart-5/40 text-accent-foreground",
  bad: "bg-destructive/10 text-destructive",
  neutral: "bg-muted text-muted-foreground",
} as const;

export type AuditRow = {
  /** "Omar joined the team" */
  title: string;
  /** "with an invite code · 3 members now" (may be empty) */
  detail: string;
  /** Who did it, for the "By" column ("System" when no one did). */
  by: string;
  category: { label: string; key: AuditCategory };
  status: { label: string; className: string };
};

const CATEGORY = {
  team: { label: "Team", key: "team" },
  requests: { label: "Request", key: "requests" },
  invites: { label: "Invite", key: "invites" },
} as const;

const members = (count: unknown) =>
  typeof count === "number" ? `${count} member${count === 1 ? "" : "s"} now` : "";

const join = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" · ");

const VIA: Record<string, string> = {
  board: "from the board",
  code: "with an invite code",
  request: "join request approved",
};

const CANCEL_REASON: Record<string, string> = {
  JOINED_TEAM: "they joined another team",
  CREATED_TEAM: "they created their own team",
  APPROVED_ELSEWHERE: "another team accepted them",
  TEAM_DELETED: "the team was deleted",
  WITHDREW: "they left the hackathon",
};

const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const TIME = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

/** Fixed time zone so the server and the browser render the same text. */
export function when(iso: string): { date: string; time: string } {
  const at = new Date(iso);
  return { date: DATE_TIME.format(at), time: `${TIME.format(at)} UTC` };
}

/** One audit entry as a readable row. Unknown actions still render (as their raw name). */
export function describe(entry: AuditEntryView): AuditRow {
  const actor = entry.actor?.name ?? "Someone";
  const target = entry.target?.name ?? "Someone";
  const d = entry.details;
  const by = entry.actor?.name ?? "System";

  switch (entry.action) {
    case "TEAM_CREATED":
      return {
        title: `${actor} created the team`,
        detail: join(
          d.joinPolicy === "OPEN" ? "Open" : d.joinPolicy === "APPROVAL" ? "Approval" : null,
          d.access === "INVITE_ONLY" ? "Invite only" : d.access === "PUBLIC" ? "Public" : null,
        ),
        by,
        category: CATEGORY.team,
        status: { label: "Created", className: TONE.good },
      };
    case "TEAM_DELETED":
      return {
        title: "The team was deleted",
        detail: join(
          d.reason === "LAST_MEMBER_LEFT" && "the last member left",
          typeof d.droppedRequests === "number" &&
            d.droppedRequests > 0 &&
            `${d.droppedRequests} pending request${d.droppedRequests === 1 ? "" : "s"} cancelled`,
        ),
        by,
        category: CATEGORY.team,
        status: { label: "Deleted", className: TONE.bad },
      };
    case "MEMBER_JOINED": {
      // Approved requests: the leader acted, the requester (target) joined.
      const who = d.via === "request" ? target : actor;
      return {
        title: `${who} joined the team`,
        detail: join(typeof d.via === "string" && VIA[d.via], members(d.memberCount)),
        by,
        category: CATEGORY.team,
        status: { label: "Joined", className: TONE.good },
      };
    }
    case "MEMBER_LEFT":
      return {
        title: `${actor} left the team`,
        detail: members(d.memberCount),
        by,
        category: CATEGORY.team,
        status: { label: "Left", className: TONE.neutral },
      };
    case "MEMBER_REMOVED":
      return {
        title: `${target} was removed`,
        detail: members(d.memberCount),
        by,
        category: CATEGORY.team,
        status: { label: "Removed", className: TONE.bad },
      };
    case "LEADER_CHANGED":
      return {
        title: `${target} is now the leader`,
        detail: d.reason === "LEADER_LEFT" ? `${actor} left the team` : "",
        by,
        category: CATEGORY.team,
        status: { label: "New leader", className: TONE.wait },
      };
    case "LOOKING_TOGGLED":
      return {
        title: d.isLooking ? "Looking for members turned on" : "Looking for members turned off",
        detail: d.isLooking ? "shown on the board" : "hidden from the board",
        by,
        category: CATEGORY.team,
        status: d.isLooking
          ? { label: "Looking", className: TONE.good }
          : { label: "Not looking", className: TONE.neutral },
      };
    case "REQUEST_CREATED":
      return {
        title: `${actor} asked to join`,
        detail: typeof d.via === "string" ? (VIA[d.via] ?? "") : "",
        by,
        category: CATEGORY.requests,
        status: { label: "Sent", className: TONE.wait },
      };
    case "REQUEST_APPROVED":
      return {
        title: `${target}'s request was approved`,
        detail: "",
        by,
        category: CATEGORY.requests,
        status: { label: "Approved", className: TONE.good },
      };
    case "REQUEST_DECLINED":
      return {
        title: `${target}'s request was declined`,
        detail:
          d.reason === "TEAM_FULL"
            ? "the team filled up first"
            : d.reason === "LEADER"
              ? "declined by the leader"
              : "",
        by: d.reason === "TEAM_FULL" ? "System" : by,
        category: CATEGORY.requests,
        status: { label: "Declined", className: TONE.bad },
      };
    case "REQUEST_CANCELLED":
      return {
        title: `${target}'s request was cancelled`,
        detail: typeof d.reason === "string" ? (CANCEL_REASON[d.reason] ?? "") : "",
        by,
        category: CATEGORY.requests,
        status: { label: "Cancelled", className: TONE.neutral },
      };
    case "INVITE_CODE_GENERATED":
      return {
        title: "New invite code created",
        detail: typeof d.expiresAt === "string" ? `expires ${when(d.expiresAt).date}` : "",
        by,
        category: CATEGORY.invites,
        status: { label: "Active", className: TONE.good },
      };
    case "INVITE_CODE_REVOKED":
      return {
        title: "Invite code revoked",
        detail: d.reason === "REGENERATED" ? "replaced by a new code" : "",
        by,
        category: CATEGORY.invites,
        status: { label: "Revoked", className: TONE.neutral },
      };
    default:
      return {
        title: String(entry.action),
        detail: "",
        by,
        category: CATEGORY.team,
        status: { label: "Event", className: TONE.neutral },
      };
  }
}
