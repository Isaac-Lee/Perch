import { useSyncExternalStore } from "react";
import type { Subagent } from "./types";

// Running children of chat sessions, keyed by pane id (ChatView knows its pane id; the Session's stored id only exists after paneSetSession).
let live: ReadonlyMap<string, Subagent[]> = new Map();
const subs = new Set<() => void>();

const same = (a: Subagent[] = [], b: Subagent[]) => a.length === b.length && a.every((x, i) => x.id === b[i].id && x.tool === b[i].tool && x.goal === b[i].goal && x.start === b[i].start);

/** Publish a pane's running children; an empty list clears it. No notification when nothing changed. */
export function setLiveSubagents(paneId: string, list: Subagent[]) {
  if (same(live.get(paneId), list) && live.has(paneId) === list.length > 0) return;
  const m = new Map(live);
  if (list.length) m.set(paneId, list); else m.delete(paneId);
  live = m;
  subs.forEach((f) => f());
}
export const getLiveSubagents = () => live;
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const useLiveSubagents = () => useSyncExternalStore(subscribe, getLiveSubagents);
