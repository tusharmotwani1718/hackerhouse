import type { RequestStatus } from "./types";

/** Status pill text + colours, shared by the inbox, the request sheet and "My requests". */
export const REQUEST_STATUS: Record<RequestStatus, { label: string; className: string }> = {
  PENDING: { label: "Pending", className: "bg-chart-5/40 text-accent-foreground" },
  APPROVED: { label: "Approved", className: "bg-primary text-primary-foreground" },
  DECLINED: { label: "Declined", className: "bg-destructive/10 text-destructive" },
  CANCELLED: { label: "Cancelled", className: "bg-muted text-muted-foreground" },
};
