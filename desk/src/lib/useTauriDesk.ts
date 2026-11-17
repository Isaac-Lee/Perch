import { useCallback, useEffect, useMemo, useState } from "react";
import { WINDOW, deskSnapshot, onPanes, paneClose, paneCreate, paneWrite, type PaneInfo } from "./backend";
import type { AgentKind, Pane, Session } from "./types";
import { folderName } from "../mock/sessions";

const sec = () => Math.floor(Date.now() / 1000);
const stoppedNone: Record<string, number> = {};

export function useTauriDesk() {
  const [now, setNow] = useState(sec);
  const [infos, setInfos] = useState<PaneInfo[]>([]);
  const [focusedPaneId, setFocused] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(sec()), 1000);
    let off = () => {};
    let dead = false;
    deskSnapshot().then((p) => { if (!dead) setInfos(p); }, console.error);
    onPanes((p) => setInfos(p)).then((u) => { if (dead) u(); else off = u; });
    return () => { dead = true; clearInterval(t); off(); };
  }, []);

  const panes = useMemo<Pane[]>(() => infos.filter((i) => i.window === WINDOW)
    .map((i) => ({ id: i.id, agent: i.agent, cwd: i.cwd, sessionId: i.id, title: folderName(i.cwd), branch: i.branch })), [infos]);
  const sessions = useMemo<Session[]>(() => infos.map((i) => ({
    agent: i.agent, sessionId: i.id, cwd: i.cwd, repoRoot: i.repoRoot, branch: i.branch,
    state: "idle", since: i.createdAt, seen: i.createdAt, prompt: "", title: folderName(i.cwd), paneId: i.window === WINDOW ? i.id : null,
    pending: null, subagents: [], todos: [], steps: 0, tool: "", toolDetail: "", turnStart: null, usage: null,
  })), [infos]);

  useEffect(() => { setFocused((f) => (f && !infos.some((i) => i.id === f) ? null : f)); }, [infos]);

  const addPane = useCallback((agent: AgentKind, cwd: string) => { paneCreate(agent, cwd).then(setFocused, console.error); }, []);
  const closePane = useCallback((id: string) => { paneClose(id).catch(console.error); }, []);
  // other windows' sessions: no-op until multi-window (T4)
  const focusSession = useCallback((sessionId: string) => { if (panes.some((p) => p.id === sessionId)) setFocused(sessionId); }, [panes]);
  const stop = useCallback((sessionId: string) => { paneWrite(sessionId, "\x03").catch(console.error); }, []);
  const approve = useCallback((_sessionId: string, _allow: boolean) => {}, []);

  return { now, sessions, panes, focusedPaneId, focusPane: setFocused, focusSession, addPane, closePane, approve, stop, stopped: stoppedNone };
}
