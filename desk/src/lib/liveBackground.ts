import { useSyncExternalStore } from "react";

// Background task ids started from chat panes -> the pane that started them (running and finished, until that ChatView unmounts).
// The sidebar uses it to nest the `bg_*` session under its parent row.
let tasks: ReadonlyMap<string, string> = new Map();
const subs = new Set<() => void>();

/** Publish a pane's task ids (replaces its earlier list; empty clears). No notification when nothing changed. */
export function setBackgroundTasks(paneId: string, ids: string[]) {
  const mine = [...tasks].filter(([, p]) => p === paneId).map(([id]) => id);
  if (mine.length === ids.length && mine.every((id) => ids.includes(id))) return;
  const m = new Map([...tasks].filter(([, p]) => p !== paneId));
  ids.forEach((id) => m.set(id, paneId));
  tasks = m;
  subs.forEach((f) => f());
}
export const getBackgroundTasks = () => tasks;
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const useBackgroundTasks = () => useSyncExternalStore(subscribe, getBackgroundTasks);
