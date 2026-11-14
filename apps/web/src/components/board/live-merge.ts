import type { BoardFilters, BoardTeam } from "./types";

/**
 * The board's loaded list + live events (05 §3.1). Pure: (state, action) → state, so the list
 * and its count always change together (and React may call it twice in dev without effect).
 *
 * `recent` holds the last event per team since the stream's last ready/resync. A server
 * snapshot can be older than events already merged (a refresh rendered just before a commit
 * arrives after that commit's event), so every reset replays them: versions make the replay a
 * no-op for anything the snapshot already has. Cleared on ready/resync, since the refetch that
 * follows covers everything up to then (and an event lost in a gap must not be replayed over it).
 */
type LiveEvent = { event: string; data: unknown };

export type ListState = {
  teams: BoardTeam[];
  count: number;
  cursor: string | null;
  recent: Map<string, LiveEvent>;
};

export type ListAction =
  | {
      type: "reset";
      teams: BoardTeam[];
      count: number;
      cursor: string | null;
      filters: BoardFilters;
    }
  | { type: "appendPage"; teams: BoardTeam[]; cursor: string | null }
  | { type: "event"; event: string; data: unknown; filters: BoardFilters }
  | { type: "synced" };

/** Same filters as the server applies (show/policy/access/name search). */
export function matchesFilters(team: BoardTeam, filters: BoardFilters): boolean {
  if (filters.show === "looking" && !team.listed) return false;
  if (filters.policy && team.joinPolicy !== filters.policy) return false;
  if (filters.access && team.access !== filters.access) return false;
  if (filters.q && !team.name.toLowerCase().includes(filters.q.toLowerCase())) return false;
  return true;
}

/** The board's order: newest first, then id (descending), like the server's keyset. */
const newerFirst = (a: BoardTeam, b: BoardTeam) =>
  b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);

/** An event payload as a card (the server's TeamCard JSON: same fields, dates as strings). */
function asCard(data: unknown): BoardTeam | null {
  const card = data as Partial<BoardTeam> | null;
  if (!card || typeof card.id !== "string" || typeof card.version !== "number") return null;
  return card as BoardTeam;
}

export function listReducer(state: ListState, action: ListAction): ListState {
  switch (action.type) {
    case "reset": {
      let next: ListState = {
        ...state,
        teams: action.teams,
        count: action.count,
        cursor: action.cursor,
      };
      for (const { event, data } of state.recent.values())
        next = applyEvent(next, event, data, action.filters);
      return next;
    }
    case "synced":
      return state.recent.size === 0 ? state : { ...state, recent: new Map() };
    case "appendPage": {
      const seen = new Set(state.teams.map((team) => team.id));
      return {
        ...state,
        teams: [...state.teams, ...action.teams.filter((team) => !seen.has(team.id))],
        cursor: action.cursor,
      };
    }
    case "event": {
      const id = (action.data as { id?: unknown } | null)?.id;
      const recent =
        typeof id === "string"
          ? new Map(state.recent).set(id, { event: action.event, data: action.data })
          : state.recent;
      return { ...applyEvent(state, action.event, action.data, action.filters), recent };
    }
  }
}

function applyEvent(
  state: ListState,
  event: string,
  data: unknown,
  filters: BoardFilters,
): ListState {
  if (event === "team.deleted") {
    const { id } = data as { id?: string };
    if (!state.teams.some((team) => team.id === id)) return state;
    return {
      ...state,
      teams: state.teams.filter((team) => team.id !== id),
      count: Math.max(0, state.count - 1),
    };
  }
  if (event !== "team.created" && event !== "team.updated") return state;
  const card = asCard(data);
  if (!card) return state;

  const fits = matchesFilters(card, filters);
  const index = state.teams.findIndex((team) => team.id === card.id);

  if (index >= 0) {
    // Shown: replace only with a NEWER version (duplicates / out-of-order events are ignored);
    // drop it if it no longer fits (filled up, stopped looking, …).
    
    if (card.version <= state.teams[index]!.version) return state; // incoming version is less than what we already have
    if (!fits) {
      return {
        ...state,
        teams: state.teams.filter((team) => team.id !== card.id),
        count: Math.max(0, state.count - 1),
      };
    }
    const teams = [...state.teams];
    teams[index] = card; // update the team with the incoming card
    return { ...state, teams };
  }

  // Not shown: insert only if it fits AND belongs within the loaded range; anything older
  // than the last loaded card arrives with a later page instead.
  if (!fits) return state;
  const oldest = state.teams.at(-1);
  const inRange = state.cursor === null || !oldest || newerFirst(card, oldest) <= 0;
  if (!inRange) {
    // Beyond the loaded pages. A new team adds one; for an update we can't tell whether it
    // already matched (and was counted), so the count waits for the next resync.
    return event === "team.created" ? { ...state, count: state.count + 1 } : state;
  }
  // Within the loaded range every matching team is loaded, so an unseen one is new to the
  // filter: show it and count it.
  return {
    ...state,
    teams: [...state.teams, card].sort(newerFirst),
    count: state.count + 1,
  };
}
