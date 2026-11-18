import type { Group, Session, SessionStateName } from "./types";

export const COMMON_LABEL = "Shared workspace";
/** States that are a real prompt (approve buttons, approval keys). "reply" (see displayState) is not one of them. */
export const MY_TURN: SessionStateName[] = ["approval", "question"];

const STALE_SEC = 600;
const RECENT_SEC = 86400;
const DROP_SEC = 604800;

export type DisplayState = Exclude<SessionStateName, "idle"> | "stale" | "done" | "ready" | "reply";

export function displayState(s: Session, now: number): DisplayState {
  if (s.state === "idle") return s.prompt ? (s.asks ? "reply" : "done") : "ready";
  const working = s.state === "running" || s.state === "thinking" || s.state === "tool";
  return working && now - s.seen > STALE_SEC ? "stale" : s.state;
}

/** 화면에 보여줄 경과 초. null이면 시간을 표시하지 않는다. */
/** Waiting on the user: a real prompt, or a finished reply that ends with a question. */
export const waitingOnYou = (s: Session, now: number): boolean => MY_TURN.includes(s.state) || displayState(s, now) === "reply";

export function shownSeconds(s: Session, now: number): number | null {
  switch (displayState(s, now)) {
    case "running": case "thinking": case "tool": return now - (s.turnStart ?? s.since);
    case "approval": case "question": case "stale": return now - s.since;
    case "done": case "reply": return s.lastTurn ?? null;
    default: return null;
  }
}

function rank(s: Session, now: number): number {
  switch (displayState(s, now)) {
    case "approval": return 0;
    case "question": return 1;
    case "reply": return 1.5;
    case "done": return 2;
    case "plain":
    case "ready": return 3.5;
    case "stale": return 4;
    case "closed": return 5;
    default: return 3;
  }
}

const parts = (p: string) => p.split(/[\\/]+/).filter(Boolean);

/** One key per folder however it was spelled: Hermes, git and the folder picker disagree on slashes,
 *  drive-letter case and trailing separators. Windows paths (drive letter) compare case-insensitively. */
export function folderKey(p: string): string {
  const s = parts(p).join("/");
  return /^[a-z]:/i.test(s) ? s.toLowerCase() : p.startsWith("/") ? `/${s}` : s;
}

/** The folder a session belongs to: its git repo root, else the folder it started in. */
export const sessionFolder = (s: Session): string | null => s.repoRoot ?? (s.cwd || null);

/** folder path -> display label; different folders with the same name get the parent folder appended. */
export function projectLabels(roots: string[]): Map<string, string> {
  const uniq = [...new Set(roots)];
  const base = (r: string) => parts(r).at(-1) ?? r;
  const folders = new Map<string, Set<string>>();
  for (const r of uniq) {
    const b = base(r).toLowerCase();
    if (!folders.has(b)) folders.set(b, new Set());
    folders.get(b)!.add(folderKey(r));
  }
  return new Map(uniq.map((r) => {
    const p = parts(r);
    return [r, folders.get(base(r).toLowerCase())!.size > 1 && p.length >= 2 ? `${base(r)} (${p[p.length - 2]})` : base(r)];
  }));
}

export type SessionSort = "status" | "recent" | "name" | "manual";
export const SESSION_SORTS: SessionSort[] = ["status", "recent", "name", "manual"];

/** New array: `id` moved so it ends at `toIndex` (clamped). Unknown id or no change returns a copy. */
export function moveInOrder(visibleIds: string[], id: string, toIndex: number): string[] {
  const out = visibleIds.filter((x) => x !== id);
  if (out.length === visibleIds.length) return visibleIds.slice();
  out.splice(Math.max(0, Math.min(out.length, toIndex)), 0, id);
  return out;
}

export function groupSessions(sessions: Session[], now: number, sort: SessionSort = "status", order: string[] = [], dismissed: ReadonlySet<string> = new Set()): Group[] {
  const map = new Map<string, Group>();
  for (const s of sessions) {
    const age = now - s.seen;
    if (!s.paneId && age > DROP_SEC) continue;
    const root = sessionFolder(s); // "common" only when even the start folder is unknown
    const key = root ? folderKey(root) : "common";
    let g = map.get(key);
    if (!g) {
      g = { key, path: root ?? "", label: root ? (parts(root).at(-1) ?? root) : COMMON_LABEL, isCommon: !root, sessions: [], recent: [] };
      map.set(key, g);
    }
    const isRecent = !s.paneId && (dismissed.has(s.sessionId) || s.state === "closed" || age > RECENT_SEC);
    (isRecent ? g.recent : g.sessions).push(s);
  }
  const groups = [...map.values()];

  const labels = projectLabels(groups.filter((g) => !g.isCommon).map((g) => g.path));
  for (const g of groups) if (!g.isCommon) g.label = labels.get(g.path)!;

  const bySort = (a: Session, b: Session) => rank(a, now) - rank(b, now) || a.since - b.since;
  const pos = new Map(order.map((id, i) => [id, i] as const));
  const title = (s: Session) => sessionTitle(s);
  const cmp: Record<SessionSort, (a: Session, b: Session) => number> = {
    status: bySort,
    recent: (a, b) => b.seen - a.seen || bySort(a, b),
    name: (a, b) => Number(!title(a)) - Number(!title(b)) || title(a).localeCompare(title(b), undefined, { numeric: true, sensitivity: "base" }) || bySort(a, b),
    // unknown (new) sessions go after the known ones, in status order
    manual: (a, b) => (pos.get(a.sessionId) ?? Infinity) - (pos.get(b.sessionId) ?? Infinity) || bySort(a, b),
  };
  for (const g of groups) {
    g.sessions.sort(cmp[sort]);
    g.recent.sort((a, b) => b.seen - a.seen);
  }
  const mine = (g: Group) => g.sessions.some((s) => waitingOnYou(s, now));
  // common group last; groups with a my-turn session first
  return groups.sort((a, b) => Number(a.isCommon) - Number(b.isCommon) || Number(mine(b)) - Number(mine(a)));
}

/** q must already be trimmed and lowercased. */
export const sessionTitle = (s: Session) => s.title || s.prompt;

export function matchSession(s: Session, q: string): boolean {
  const hay = [sessionTitle(s), s.cwd, s.branch].join(" ").toLowerCase();
  return q.split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

/** Counts shown on a collapsed group title so waiting/working sessions are not missed. */
export function groupSummary(g: Group, now: number): { mine: number; working: number } {
  let mine = 0, working = 0;
  for (const s of g.sessions) {
    if (waitingOnYou(s, now)) mine++;
    else if (["running", "thinking", "tool"].includes(displayState(s, now))) working++;
  }
  return { mine, working };
}
