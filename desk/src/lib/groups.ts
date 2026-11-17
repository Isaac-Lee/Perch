import type { Group, Session, SessionStateName } from "./types";

export const COMMON_LABEL = "Shared workspace";
export const MY_TURN: SessionStateName[] = ["approval", "question"];

const STALE_SEC = 600;
const RECENT_SEC = 86400;
const DROP_SEC = 604800;

export type DisplayState = Exclude<SessionStateName, "idle"> | "stale" | "done" | "ready";

export function displayState(s: Session, now: number): DisplayState {
  if (s.state === "idle") return s.prompt ? "done" : "ready";
  const working = s.state === "running" || s.state === "thinking" || s.state === "tool";
  return working && now - s.seen > STALE_SEC ? "stale" : s.state;
}

/** 화면에 보여줄 경과 초. null이면 시간을 표시하지 않는다. */
export function shownSeconds(s: Session, now: number): number | null {
  switch (displayState(s, now)) {
    case "running": case "thinking": case "tool": return now - (s.turnStart ?? s.since);
    case "approval": case "question": case "stale": return now - s.since;
    case "done": return s.lastTurn ?? null;
    default: return null;
  }
}

function rank(s: Session, now: number): number {
  switch (displayState(s, now)) {
    case "approval": return 0;
    case "question": return 1;
    case "done": return 2;
    case "plain":
    case "ready": return 3.5;
    case "stale": return 4;
    case "closed": return 5;
    default: return 3;
  }
}

const parts = (p: string) => p.split(/[\\/]+/).filter(Boolean);

/** repoRoot -> display label; same-named repos get the parent folder appended. */
export function projectLabels(roots: string[]): Map<string, string> {
  const uniq = [...new Set(roots)];
  const base = (r: string) => parts(r).at(-1) ?? r;
  const count = new Map<string, number>();
  for (const r of uniq) count.set(base(r), (count.get(base(r)) ?? 0) + 1);
  return new Map(uniq.map((r) => {
    const p = parts(r);
    return [r, count.get(base(r))! > 1 && p.length >= 2 ? `${base(r)} (${p[p.length - 2]})` : base(r)];
  }));
}

export function groupSessions(sessions: Session[], now: number): Group[] {
  const map = new Map<string, Group>();
  for (const s of sessions) {
    const age = now - s.seen;
    if (!s.paneId && age > DROP_SEC) continue;
    const key = s.repoRoot ?? "common";
    let g = map.get(key);
    if (!g) {
      const label = s.repoRoot ? (parts(s.repoRoot).at(-1) ?? s.repoRoot) : COMMON_LABEL;
      g = { key, label, isCommon: !s.repoRoot, sessions: [], recent: [] };
      map.set(key, g);
    }
    const isRecent = !s.paneId && (s.state === "closed" || age > RECENT_SEC);
    (isRecent ? g.recent : g.sessions).push(s);
  }
  const groups = [...map.values()];

  const labels = projectLabels(groups.filter((g) => !g.isCommon).map((g) => g.key));
  for (const g of groups) if (!g.isCommon) g.label = labels.get(g.key)!;

  const bySort = (a: Session, b: Session) => rank(a, now) - rank(b, now) || a.since - b.since;
  for (const g of groups) {
    g.sessions.sort(bySort);
    g.recent.sort((a, b) => b.seen - a.seen);
  }
  const mine = (g: Group) => g.sessions.some((s) => MY_TURN.includes(s.state));
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
    if (MY_TURN.includes(s.state)) mine++;
    else if (["running", "thinking", "tool"].includes(displayState(s, now))) working++;
  }
  return { mine, working };
}
