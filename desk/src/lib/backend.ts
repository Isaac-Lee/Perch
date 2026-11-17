import { invoke, Channel } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { AgentKind } from "./types";
export const isTauri = "__TAURI_INTERNALS__" in window;

/** Tauri: 네이티브 폴더 선택창. 브라우저: null (호출 측이 입력칸을 보여준다). */
export async function pickFolder(): Promise<string | null> {
  if (!isTauri) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const p = await open({ directory: true, multiple: false });
  return typeof p === "string" ? p : null;
}

export type PaneInfo = { id: string; agent: AgentKind; cwd: string; repoRoot: string | null; branch: string | null; window: string; createdAt: number };

export let HOME = "";
export let WINDOW = "main";
export async function initBackend(): Promise<void> {
  if (!isTauri) return;
  HOME = await invoke<string>("home_dir");
  WINDOW = getCurrentWindow().label;
}

export const paneCreate = (agent: AgentKind, cwd: string) => invoke<string>("pane_create", { agent, cwd });
export function paneAttach(id: string, cols: number, rows: number, onData: (bytes: Uint8Array) => void): Promise<void> {
  const channel = new Channel();
  channel.onmessage = (m) => onData(new Uint8Array(m as ArrayBuffer | number[]));
  return invoke("pane_attach", { id, cols, rows, onData: channel });
}
export const paneWrite = (id: string, data: string) => invoke<void>("pane_write", { id, data });
export const paneResize = (id: string, cols: number, rows: number) => invoke<void>("pane_resize", { id, cols, rows });
export const paneClose = (id: string) => invoke<void>("pane_close", { id });
export const deskSnapshot = () => invoke<PaneInfo[]>("desk_snapshot");
export const windowNew = () => invoke<void>("window_new");
export const windowFocus = (label: string) => invoke<void>("window_focus", { label });
export const paneFocus = (id: string) => invoke<void>("pane_focus", { id });
export const onFocusPane = (cb: (id: string) => void): Promise<() => void> => listen<string>("desk://focus", (e) => cb(e.payload));
export const onPanes = (cb: (p: PaneInfo[]) => void): Promise<() => void> => listen<PaneInfo[]>("desk://panes", (e) => cb(e.payload));
