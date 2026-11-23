import { invoke, Channel } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { AgentKind, PaneView } from "./types";
export type { PaneView } from "./types";
export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Tauri: 네이티브 폴더 선택창. 브라우저: null (호출 측이 입력칸을 보여준다). */
export async function pickFolder(): Promise<string | null> {
  if (!isTauri) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const p = await open({ directory: true, multiple: false });
  return typeof p === "string" ? p : null;
}

export type PaneInfo = { id: string; agent: AgentKind; cwd: string; repoRoot: string | null; branch: string | null; window: string; createdAt: number; sessionId: string | null; view: PaneView };

export type SessionInfo = {
  agent: AgentKind; sessionId: string; state: string; since: number; turnStart: number | null; lastTurn: number | null; busyTotal?: number; steps: number;
  tool: string; toolDetail: string; prompt: string; pending: { kind: string; id: string; text: string } | null;
  asks?: boolean; ask?: string;
  subagents: { id: string; role: string; goal: string; start: number; tool?: string }[];
  todos: { text: string; status: string }[]; seen: number;
  paneId: string | null; parentId?: string | null; title: string | null; cwd: string; repoRoot: string | null; branch: string | null;
  usage: { model: string; input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number; apiCalls: number; costUsd: number | null; startedAt: number } | null;
};
export type HermesStatus = { home: string; exe: string | null; connected: boolean; hookPath: string; outdated: boolean; autoUpdated: boolean };

export let HOME = "";
export let WINDOW = "main";
export async function initBackend(): Promise<void> {
  if (!isTauri) return;
  HOME = await invoke<string>("home_dir");
  WINDOW = getCurrentWindow().label;
}

export const paneCreate = (agent: AgentKind, cwd: string, resume?: string, view?: PaneView) => invoke<string>("pane_create", { agent, cwd, resume, view });
export function chatConnect(id: string, onLine: (line: string) => void): Promise<void> {
  const channel = new Channel<string>();
  channel.onmessage = onLine;
  return invoke("chat_connect", { id, onLine: channel });
}
export const chatSend = (id: string, line: string) => invoke<void>("chat_send", { id, line });
export const chatClose = (id: string) => invoke<void>("chat_close", { id });
export const paneSetSession = (id: string, sessionId: string) => invoke<void>("pane_set_session", { id, sessionId });
export const sessionsSnapshot = () => invoke<SessionInfo[]>("sessions_snapshot");
export const onSessions = (cb: (s: SessionInfo[]) => void): Promise<() => void> => listen<SessionInfo[]>("desk://sessions", (e) => cb(e.payload));
export const sessionApprove = (sessionId: string, allow: boolean) => invoke<void>("session_approve", { sessionId, allow });
/** Marks a still-"working" session file idle. delayMs 0 = now (chat resync); the TUI Stop waits a moment for Hermes' own on_session_end. */
export const sessionForceIdle = (sessionId: string, delayMs = 1500) => invoke<boolean>("session_force_idle", { sessionId, delayMs });
export const hermesStatus = () => invoke<HermesStatus>("hermes_status");
export const hermesConnect = () => invoke<HermesStatus>("hermes_connect");
export const hermesDisconnect = () => invoke<HermesStatus>("hermes_disconnect");
export const hermesGatewayStop = () => invoke<void>("hermes_gateway_stop");
export const usageHistory = () => invoke<SessionInfo[]>("usage_history");
export function paneAttach(id: string, cols: number, rows: number, onData: (bytes: Uint8Array) => void): Promise<void> {
  const channel = new Channel();
  channel.onmessage = (m) => onData(new Uint8Array(m as ArrayBuffer | number[]));
  return invoke("pane_attach", { id, cols, rows, onData: channel });
}
/** Bytes of an image Hermes stored earlier (restricted to image files under the Hermes home). */
export const readImage = async (path: string): Promise<Uint8Array> => new Uint8Array(await invoke<ArrayBuffer>("read_image", { path }));
export const openUrl = (url: string) => invoke<void>("open_url", { url });
export const paneWrite = (id: string, data: string) => invoke<void>("pane_write", { id, data });
export const paneResize = (id: string, cols: number, rows: number) => invoke<void>("pane_resize", { id, cols, rows });
export const paneClose = (id: string) => invoke<void>("pane_close", { id });
export const deskSnapshot = () => invoke<PaneInfo[]>("desk_snapshot");
export const windowNew = () => invoke<void>("window_new");
export const windowFocus = (label: string) => invoke<void>("window_focus", { label });
export const paneFocus = (id: string) => invoke<void>("pane_focus", { id });
export const onFocusPane = (cb: (id: string) => void): Promise<() => void> => listen<string>("desk://focus", (e) => cb(e.payload));
export const onChatApprove = (cb: (p: { paneId: string; allow: boolean }) => void): Promise<() => void> => listen<{ paneId: string; allow: boolean }>("desk://chat-approve", (e) => cb(e.payload));
export const onChatStop = (cb: (p: { paneId: string }) => void): Promise<() => void> => listen<{ paneId: string }>("desk://chat-stop", (e) => cb(e.payload));
export const emitChatStop = (paneId: string): Promise<void> => emit("desk://chat-stop", { paneId });
export const onPanes =(cb: (p: PaneInfo[]) => void): Promise<() => void> => listen<PaneInfo[]>("desk://panes", (e) => cb(e.payload));
