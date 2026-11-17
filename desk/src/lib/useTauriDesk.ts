import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WINDOW, deskSnapshot, onFocusPane, onPanes, paneClose, paneCreate, paneFocus, paneWrite, windowFocus, type PaneInfo } from "./backend";
import type { AgentKind, Pane, Session } from "./types";
import { folderName } from "../mock/sessions";

const sec = () => Math.floor(Date.now() / 1000);
const stoppedNone: Record<string, number> = {};

export function useTauriDesk() {
  const [now, setNow] = useState(sec);
  const [infos, setInfos] = useState<PaneInfo[]>([]);
  const [focusedPaneId, setFocused] = useState<string | null>(null);
  const infosRef = useRef(infos);
  infosRef.current = infos;

  useEffect(() => {
    const t = setInterval(() => setNow(sec()), 1000);
    let off = () => {};
    let dead = false;
    deskSnapshot().then((p) => { if (!dead) setInfos(p); }, console.error);
    onPanes((p) => setInfos(p)).then((u) => { if (dead) u(); else off = u; });
    let off2 = () => {};
    onFocusPane((id) => { if (infosRef.current.some((i) => i.id === id && i.window === WINDOW)) setFocused(id); })
      .then((u) => { if (dead) u(); else off2 = u; });
    return () => { dead = true; clearInterval(t); off(); off2(); };
  }, []);

  const panes = useMemo<Pane[]>(() => infos.filter((i) => i.window === WINDOW)
    .map((i) => ({ id: i.id, agent: i.agent, cwd: i.cwd, sessionId: i.id, title: folderName(i.cwd), branch: i.branch })), [infos]);
  const sessions = useMemo<Session[]>(() => infos.map((i) => ({
    agent: i.agent, sessionId: i.id, cwd: i.cwd, repoRoot: i.repoRoot, branch: i.branch,
    state: "plain", since: i.createdAt, seen: i.createdAt, prompt: "", title: folderName(i.cwd), paneId: i.window === WINDOW ? i.id : null,
    pending: null, subagents: [], todos: [], steps: 0, tool: "", toolDetail: "", turnStart: null, usage: null,
  })), [infos]);

  useEffect(() => { setFocused((f) => (f && !infos.some((i) => i.id === f) ? null : f)); }, [infos]);

  const addPane = useCallback((agent: AgentKind, cwd: string) => { paneCreate(agent, cwd).then(setFocused, console.error); }, []);
  const closePane = useCallback((id: string) => { paneClose(id).catch(console.error); }, []);
  const focusSession = useCallback((sessionId: string) => {
    const info = infos.find((i) => i.id === sessionId);
    if (!info) return;
    if (info.window === WINDOW) setFocused(sessionId);
    else paneFocus(sessionId).then(() => windowFocus(info.window)).catch(console.error);
  }, [infos]);
  const stop = useCallback((sessionId: string) => { paneWrite(sessionId, "\x03").catch(console.error); }, []);
  const approve = useCallback((_sessionId: string, _allow: boolean) => {}, []);

  return { now, sessions, panes, focusedPaneId, focusPane: setFocused, focusSession, addPane, closePane, approve, stop, stopped: stoppedNone };
}
