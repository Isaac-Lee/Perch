import type { AgentKind } from "./types";

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

export interface NewPaneDefaults { agent: AgentKind; cwd: string }
export const loadNewPane = (firstFolder: string): NewPaneDefaults => {
  const v = read<Partial<NewPaneDefaults> | null>("perch.newPane", null);
  const agent = v && (v.agent === "hermes" || v.agent === "opencode" || v.agent === "shell") ? v.agent : "hermes";
  return { agent, cwd: v && typeof v.cwd === "string" && v.cwd.trim() ? v.cwd : firstFolder };
};
export const saveNewPane = (v: NewPaneDefaults) => write("perch.newPane", v);
