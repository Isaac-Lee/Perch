import type { AgentKind, PaneView } from "./types";
import { SESSION_SORTS, type SessionSort } from "./groups";

// ponytail: localStorage until stage 2 moves settings to a Tauri config file
const read = <T>(key: string, fallback: T): T => {
  try { const v = localStorage.getItem(key); return v === null ? fallback : (JSON.parse(v) as T); } catch { return fallback; }
};
const write = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ } };

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

export const MAX_ORDER = 300;
export const loadSessionOrder = (): string[] => { const v = read<unknown>("perch.sessionOrder", []); return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, MAX_ORDER) : []; };
export const saveSessionOrder = (ids: string[]) => write("perch.sessionOrder", ids.slice(0, MAX_ORDER));

export const loadDismissed = (): string[] => { const v = read<unknown>("perch.dismissedSessions", []); return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(-MAX_ORDER) : []; };
export const saveDismissed = (ids: string[]) => write("perch.dismissedSessions", ids.slice(-MAX_ORDER));

export const THEMES = [["dark", "Dark"], ["midnight", "Midnight"], ["black", "Black"], ["light", "Light"]] as const;
export type ThemeId = (typeof THEMES)[number][0];
export const loadTheme = (): ThemeId => { const v = read<unknown>("perch.theme", "dark"); return THEMES.some(([id]) => id === v) ? (v as ThemeId) : "dark"; };
export const saveTheme = (t: ThemeId) => write("perch.theme", t);

export const loadPaneLayout = (): string[][] => {
  const v = read<unknown>("perch.paneLayout", []);
  return Array.isArray(v) && v.every((c) => Array.isArray(c) && c.length > 0 && c.every((x) => typeof x === "string")) ? (v as string[][]) : [];
};
export const savePaneLayout = (l: string[][]) => write("perch.paneLayout", l);

export interface NewPaneDefaults { agent: AgentKind; cwd: string; view: PaneView }
export const loadNewPane = (firstFolder: string): NewPaneDefaults => {
  const v = read<Partial<NewPaneDefaults> | null>("perch.newPane", null);
  const agent = v && (v.agent === "hermes" || v.agent === "opencode" || v.agent === "shell") ? v.agent : "hermes";
  const view: PaneView = v && v.view === "tui" ? "tui" : "chat";
  return { agent, view, cwd: v && typeof v.cwd === "string" && v.cwd.trim() ? v.cwd : firstFolder };
};
// Windows paths: case-insensitive, / == \, trailing separator ignored (root like C:\ kept)
const folderKey = (p: string) => { const s = p.replace(/\//g, "\\"); return (s.length > 3 ? s.replace(/\\+$/, "") : s).toLowerCase(); };
export const sameFolder = (a: string, b: string) => folderKey(a) === folderKey(b);
const dedupe = (l: string[]) => l.filter((x, i) => l.findIndex((y) => sameFolder(x, y)) === i);
export const pushRecent = (list: string[], f: string): string[] => [f, ...list.filter((x) => !sameFolder(x, f))].slice(0, 8);
export const removeRecent = (list: string[], f: string): string[] => list.filter((x) => !sameFolder(x, f));
export const loadRecentFolders = (seed: string[]): string[] => {
  const v = read<unknown>("perch.recentFolders", null);
  return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string") ? dedupe(v) : seed;
};
export const saveRecentFolders = (list: string[]) => write("perch.recentFolders", list);
export const saveNewPane =(v: NewPaneDefaults) => write("perch.newPane", v);
