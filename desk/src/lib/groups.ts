import type { Group, Session, SessionStateName } from "./types";

export const COMMON_LABEL = "공통 작업 공간";
export const MY_TURN: SessionStateName[] = ["approval", "question", "idle"];

const STALE_SEC = 600;
const RECENT_SEC = 86400;
const DROP_SEC = 604800;

export function displayState(s: Session, now: number): SessionStateName | "stale" {
  const working = s.state === "running" || s.state === "thinking" || s.state === "tool";
  return working && now - s.seen > STALE_SEC ? "stale" : s.state;
}

function rank(s: Session, now: number): number {
  switch (displayState(s, now)) {
    case "approval": return 0;
    case "question": return 1;
    case "idle": return 2;
    case "stale": return 4;
    case "closed": return 5;
    default: return 3;
  }
}

const parts = (p: string) => p.split(/[\\/]+/).filter(Boolean);

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

  // duplicate labels get the parent folder name appended
  const byLabel = new Map<string, Group[]>();
  for (const g of groups) if (!g.isCommon) byLabel.set(g.label, [...(byLabel.get(g.label) ?? []), g]);
  for (const dup of byLabel.values()) {
    if (dup.length < 2) continue;
    for (const g of dup) {
      const p = parts(g.key);
      if (p.length >= 2) g.label = `${g.label} (${p[p.length - 2]})`;
    }
  }

  const bySort = (a: Session, b: Session) => rank(a, now) - rank(b, now) || a.since - b.since;
  for (const g of groups) {
    g.sessions.sort(bySort);
    g.recent.sort((a, b) => b.seen - a.seen);
  }
  const mine = (g: Group) => g.sessions.some((s) => MY_TURN.includes(s.state));
  // common group last; groups with a my-turn session first
  return groups.sort((a, b) => Number(a.isCommon) - Number(b.isCommon) || Number(mine(b)) - Number(mine(a)));
}
