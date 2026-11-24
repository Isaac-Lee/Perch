import { useMemo, useSyncExternalStore } from "react";
import { WINDOW } from "./backend";
import type { AgentKind, PaneView } from "./types";
import { SESSION_SORTS, type GroupBy, type SessionSort } from "./groups";

// ponytail: localStorage until stage 2 moves settings to a Tauri config file
const read = <T>(key: string, fallback: T): T => {
  try { const v = localStorage.getItem(key); return v === null ? fallback : (JSON.parse(v) as T); } catch { return fallback; }
};
// Windows share localStorage: other windows' writes arrive as `storage` events, this window's via `listeners`.
const listeners = new Set<() => void>();
if (typeof window !== "undefined") window.addEventListener("storage", () => listeners.forEach((f) => f()));
const write = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ } listeners.forEach((f) => f()); };
export const subscribeStored = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
/** Live value of a stored setting: follows writes from this and other windows. Writers must start from the
 *  current stored value (`load*()`), not from a render's copy, so windows merge instead of overwriting. */
export function useStored<T>(key: string, load: () => T): T {
  const raw = useSyncExternalStore(subscribeStored, () => { try { return localStorage.getItem(key); } catch { return null; } });
  return useMemo(load, [raw]); // eslint-disable-line react-hooks/exhaustive-deps
}

export const SIDEBAR_DEFAULT = 320;
export const clampSidebarWidth = (w: number) => (Number.isFinite(w) ? Math.min(480, Math.max(200, Math.round(w))) : SIDEBAR_DEFAULT);
export const loadSidebarWidth = () => clampSidebarWidth(read("perch.sidebarWidth", SIDEBAR_DEFAULT));
export const saveSidebarWidth = (w: number) => write("perch.sidebarWidth", w);

export const loadCollapsed = (): string[] => { const v = read<unknown>("perch.collapsedGroups", []); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; };
export const saveCollapsed = (keys: string[]) => write("perch.collapsedGroups", keys);

// ponytail: archived ids are never pruned; tiny strings, prune against history if it ever matters
export const loadArchived = (): string[] => { const v = read<unknown>("perch.archivedSessions", []); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; };
export const saveArchived = (ids: string[]) => write("perch.archivedSessions", ids);

export const loadSessionSort = (): SessionSort => { const v = read<unknown>("perch.sessionSort", "status"); return SESSION_SORTS.includes(v as SessionSort) ? (v as SessionSort) : "status"; };
export const saveSessionSort = (s: SessionSort) => write("perch.sessionSort", s);
export const loadGroupBy = (): GroupBy => { const v = read<unknown>("perch.sessionGroupBy", "folder"); return v === "status" ? "status" : "folder"; };
export const saveGroupBy = (g: GroupBy) => write("perch.sessionGroupBy", g);

export const MAX_ORDER = 300;
export const loadSessionOrder = (): string[] => { const v = read<unknown>("perch.sessionOrder", []); return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, MAX_ORDER) : []; };
export const saveSessionOrder = (ids: string[]) => write("perch.sessionOrder", ids.slice(0, MAX_ORDER));

export const loadDismissed = (): string[] => { const v = read<unknown>("perch.dismissedSessions", []); return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(-MAX_ORDER) : []; };
export const saveDismissed = (ids: string[]) => write("perch.dismissedSessions", ids.slice(-MAX_ORDER));

const capNewest = (m: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, MAX_ORDER));
/** sessionId -> unix seconds when the user last saw its result. */
export const loadReadAt = (): Record<string, number> => {
  const v = read<unknown>("perch.readAt", {});
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return capNewest(Object.fromEntries(Object.entries(v).filter((e): e is [string, number] => typeof e[1] === "number" && Number.isFinite(e[1]))));
};
export const saveReadAt = (m: Record<string, number>) => write("perch.readAt", capNewest(m));
export const markRead = (m: Record<string, number>, id: string, t: number): Record<string, number> => capNewest({ ...m, [id]: t });

export const THEMES = [["dark", "Dark"], ["midnight", "Midnight"], ["black", "Black"], ["light", "Light"]] as const;
export type ThemeId = (typeof THEMES)[number][0];
export const loadTheme = (): ThemeId => { const v = read<unknown>("perch.theme", "dark"); return THEMES.some(([id]) => id === v) ? (v as ThemeId) : "dark"; };
export const saveTheme = (t: ThemeId) => write("perch.theme", t);

// Pane ids restart at p1 every run, so the layout is stored as positions in the open-pane list ("0", "1", ...), one key per window.
const layoutKey = () => `perch.paneLayout.${WINDOW}`;
export const loadPaneLayout = (): string[][] => {
  const v = read<unknown>(layoutKey(), []);
  return Array.isArray(v) && v.every((c) => Array.isArray(c) && c.length > 0 && c.every((x) => typeof x === "string")) ? (v as string[][]) : [];
};
export const savePaneLayout = (l: string[][]) => write(layoutKey(), l);

export interface NewPaneDefaults { agent: AgentKind; cwd: string; view: PaneView }
export const loadNewPane = (firstFolder: string): NewPaneDefaults => {
  const v = read<Partial<NewPaneDefaults> | null>("perch.newPane", null);
  const agent = v && (v.agent === "hermes" || v.agent === "opencode" || v.agent === "shell") ? v.agent : "hermes";
  const view: PaneView = v && v.view === "tui" ? "tui" : "chat";
  return { agent, view, cwd: v && typeof v.cwd === "string" && v.cwd.trim() ? v.cwd : firstFolder };
};
/** Reopen the panes that were open when the app closed. */
export const loadRestorePanes = (): boolean => read<unknown>("perch.restorePanes", true) !== false;
export const saveRestorePanes = (v: boolean) => write("perch.restorePanes", v);
export interface OpenPane { agent: AgentKind; cwd: string; view: PaneView; sessionId: string | null }
export const loadOpenPanes = (): OpenPane[] => {
  const v = read<unknown>("perch.openPanes", []);
  if (!Array.isArray(v)) return [];
  return v.flatMap((p): OpenPane[] => {
    const ok = p && typeof p === "object" && (p.agent === "hermes" || p.agent === "opencode" || p.agent === "shell") && typeof p.cwd === "string" && p.cwd.trim();
    return ok ? [{ agent: p.agent, cwd: p.cwd, view: p.view === "chat" ? "chat" : "tui", sessionId: typeof p.sessionId === "string" && p.sessionId ? p.sessionId : null }] : [];
  });
};
export const saveOpenPanes = (l: OpenPane[]) => write("perch.openPanes", l);
// Windows paths: case-insensitive, / == \, trailing separator ignored (root like C:\ kept)
const folderKey = (p: string) => { const s = p.replace(/\//g, "\\"); return (s.length > 3 ? s.replace(/\\+$/, "") : s).toLowerCase(); };
export const sameFolder = (a: string, b: string) => folderKey(a) === folderKey(b);
const dedupe = (l: string[]) => l.filter((x, i) => l.findIndex((y) => sameFolder(x, y)) === i);
export const pushRecent = (list: string[], f: string): string[] => [f, ...list.filter((x) => !sameFolder(x, f))].slice(0, 8);
export const removeRecent = (list: string[], f: string): string[] => list.filter((x) => !sameFolder(x, f));
export const loadRecentFolders = (seed: string[]): string[] => {
  const v = read<unknown>("perch.recentFolders", null);
  const list = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
  return list.length > 0 ? dedupe(list) : seed.filter((x) => x.trim() !== "");
};
export const saveRecentFolders = (list: string[]) => write("perch.recentFolders", list);
export const saveNewPane =(v: NewPaneDefaults) => write("perch.newPane", v);

/** User-chosen dock of the subagent graph; null = automatic by pane width. */
export const loadGraphDock = (): "right" | "bottom" | null => { const v = read<unknown>("perch.graphDock", null); return v === "right" || v === "bottom" ? v : null; };
export const saveGraphDock = (d: "right" | "bottom") => write("perch.graphDock", d);
export const loadGraphShowDone = (): boolean => read<unknown>("perch.graphShowDone", false) === true;
export const saveGraphShowDone = (v: boolean) => write("perch.graphShowDone", v);
