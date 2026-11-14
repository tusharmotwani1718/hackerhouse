"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { cn } from "@hacker-house/ui/lib/utils";

import { openEventStream, type StreamStatus } from "@/lib/live/event-stream";

type Listener = (type: string, data: unknown) => void;
type LiveConfig = {
  hackathonId: string;
  slug: string;
  myTeamId: string | null;
  isLeader: boolean;
};

type LiveContext = {
  status: StreamStatus;
  subscribe: (listener: Listener) => () => void;
  configure: (config: LiveConfig) => void;
};

const Context = createContext<LiveContext | null>(null);

/** A request event's payload (user: channel). */
type RequestEvent = { teamId?: string; status?: string; declineReason?: string | null };

/**
 * One live stream per hackathon tab (9.x plan §1), held by the /hackathons/[slug] layout so it
 * survives switching between Board / My team / My requests.
 *
 *  - stream.ready / stream.resync / tab visible again → refetch the page (router.refresh(),
 *    debounced): closes the gap between the server render and the stream (§3).
 *  - team.* → passed to subscribers (the board merges them in place, §2).
 *  - events about me (my requests, my team, my membership, invite code) → refetch + a toast
 *    when someone ELSE did it (§5).
 */
export function HackathonLiveProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const [config, setConfig] = useState<LiveConfig | null>(null);
  const configRef = useRef<LiveConfig | null>(null);
  const listeners = useRef(new Set<Listener>());
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  const refresh = useCallback(() => {
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), 300);
  }, [router]);

  const configure = useCallback((next: LiveConfig) => {
    setConfig((current) =>
      current &&
      current.hackathonId === next.hackathonId &&
      current.myTeamId === next.myTeamId &&
      current.isLeader === next.isLeader
        ? current
        : next,
    );
  }, []);

  const subscribe = useCallback((listener: Listener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const hackathonId = config?.hackathonId;
  useEffect(() => {
    if (!hackathonId) return;
    const notify = (type: string, data: unknown) => {
      for (const listener of listeners.current) listener(type, data);
    };
    const close = openEventStream(`/api/stream?hackathonId=${hackathonId}`, {
      onStatus: setStatus,
      // Subscribers hear these too (the board drops its replay log; the refetch covers it).
      onReady: () => {
        notify("stream.ready", null);
        refresh();
      },
      onResync: () => {
        notify("stream.resync", null);
        refresh();
      },
      onUnauthorized: () => router.replace("/sign-in"),
      onEvent: (type, data) => {
        notify(type, data);
        handleMyEvent(type, data);
      },
    });
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      close();
      document.removeEventListener("visibilitychange", onVisible);
      clearTimeout(refreshTimer.current);
    };

    /** Events that change what *I* see outside the board list. */
    function handleMyEvent(type: string, data: unknown) {
      const me = configRef.current;
      if (!me) return;
      const teamLink = { label: "View", onClick: () => router.push(`/hackathons/${me.slug}/team`) };

      if (type === "team.updated" || type === "team.deleted") {
        // My team changed (members, leader, seats) or was deleted: header + My team.
        if ((data as { id?: string }).id === me.myTeamId) refresh();
        return;
      }
      if (type === "membership.removed") {
        const { teamName } = data as { teamName?: string };
        toast.warning(`You were removed from ${teamName ?? "your team"}.`);
        refresh();
        return;
      }
      if (type === "invite.updated") {
        refresh();
        return;
      }
      if (!type.startsWith("request.")) return;

      // Both the requester and the team's leader get request events: tell them apart.
      const request = data as RequestEvent;
      const forMyTeam = me.isLeader && request.teamId === me.myTeamId;
      if (forMyTeam) {
        // Leader side: a new request is someone else's doing; decisions are my own.
        if (type === "request.created")
          toast.info("Someone asked to join your team.", { action: teamLink });
      } else if (type === "request.approved") {
        toast.success("Your join request was approved: welcome to the team!", { action: teamLink });
      } else if (type === "request.declined") {
        toast.error(
          request.declineReason === "TEAM_FULL"
            ? "A team you asked to join filled up before deciding."
            : "A team leader declined your join request.",
        );
      }
      refresh();
    }
  }, [hackathonId, refresh, router]);

  return <Context.Provider value={{ status, subscribe, configure }}>{children}</Context.Provider>;
}

/** Rendered by the layout once the session and hackathon are known: starts/updates the stream. */
export function LiveConnector(config: LiveConfig) {
  const live = useContext(Context);
  const { hackathonId, slug, myTeamId, isLeader } = config;
  useEffect(() => {
    live?.configure({ hackathonId, slug, myTeamId, isLeader });
  }, [live, hackathonId, slug, myTeamId, isLeader]);
  return null;
}

/**
 * Subscribe to every live event while mounted (the board merges team.* this way), plus
 * "stream.ready" / "stream.resync" (data null) just before the refetch they trigger.
 */
export function useLiveEvents(listener: Listener) {
  const live = useContext(Context);
  const latest = useRef(listener);
  useEffect(() => {
    latest.current = listener;
  }, [listener]);
  useEffect(() => live?.subscribe((type, data) => latest.current(type, data)), [live]);
}

const LABEL: Record<StreamStatus, string> = {
  connecting: "Connecting…",
  live: "Live",
  reconnecting: "Reconnecting…",
  offline: "Offline",
};

/** Small connection indicator next to the tabs. */
export function LiveStatus() {
  const live = useContext(Context);
  if (!live) return null;
  return (
    <span
      role="status"
      aria-live="polite"
      title={
        live.status === "live"
          ? "Changes appear here as they happen"
          : "Updates are paused; they resume when the connection is back"
      }
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
    >
      <span
        aria-hidden
        className={cn(
          "size-2 rounded-full",
          live.status === "live" && "bg-primary",
          (live.status === "connecting" || live.status === "reconnecting") &&
            "animate-pulse bg-chart-4",
          live.status === "offline" && "bg-destructive",
        )}
      />
      {LABEL[live.status]}
    </span>
  );
}
