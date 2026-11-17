import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WINDOW, deskSnapshot, onFocusPane, onPanes, onSessions, paneClose, paneCreate, paneFocus, paneWrite, sessionApprove, sessionsSnapshot, windowFocus, type PaneInfo, type SessionInfo } from "./backend";
import type { AgentKind, Pane, Session } from "./types";
import { folderName } from "../mock/sessions";

const sec = () => Math.floor(Date.now() / 1000);
const stoppedNone: Record<string, number> = {};

export function toSession(s: SessionInfo, pane?: PaneInfo): Session {
  return {
    ...s, cwd: s.cwd || pane?.cwd || "", title: s.title ?? undefined, state: s.state as Session["state"],
    paneId: pane && pane.window === WINDOW ? pane.id : null,
    pending: s.pending as Session["pending"], todos: s.todos as Session["todos"],
  };
}

export function useTauriDesk() {
  const [now, setNow] = useState(sec);
  const [infos, setInfos] = useState<PaneInfo[]>([]);
  const [sInfos, setSInfos] = useState<SessionInfo[]>([]);
  const [focusedPaneId, setFocused] = useState<string | null>(null);
  const infosRef = useRef(infos);
  infosRef.current = infos;
  const sInfosRef = useRef(sInfos);
  sInfosRef.current = sInfos;

  useEffect(() => {
    const t = setInterval(() => setNow(sec()), 1000);
    let off = () => {};
    let dead = false;
    deskSnapshot().then((p) => { if (!dead) setInfos(p); }, console.error);
    onPanes((p) => setInfos(p)).then((u) => { if (dead) u(); else off = u; });
    let off3 = () => {};
    sessionsSnapshot().then((s) => { if (!dead) setSInfos(s); }, console.error);
    onSessions((s) => setSInfos(s)).then((u) => { if (dead) u(); else off3 = u; });
    let off2 = () => {};
    onFocusPane((id) => { if (infosRef.current.some((i) => i.id === id && i.window === WINDOW)) setFocused(id); })
      .then((u) => { if (dead) u(); else off2 = u; });
    return () => { dead = true; clearInterval(t); off(); off2(); off3(); };
  }, []);

  const panes = useMemo<Pane[]>(() => infos.filter((i) => i.window === WINDOW)
    .map((i) => ({ id: i.id, agent: i.agent, cwd: i.cwd, sessionId: i.sessionId ?? i.id, title: folderName(i.cwd), branch: i.branch })), [infos]);
  const sessions = useMemo<Session[]>(() => {
    const byId = new Map(infos.map((i) => [i.id, i]));
    const linked = sInfos.map((s) => toSession(s, s.paneId ? byId.get(s.paneId) : undefined));
    const plain = infos.filter((i) => !i.sessionId).map((i): Session => ({
      agent: i.agent, sessionId: i.id, cwd: i.cwd, repoRoot: i.repoRoot, branch: i.branch,
      state: "plain", since: i.createdAt, seen: i.createdAt, prompt: "", title: folderName(i.cwd), paneId: i.window === WINDOW ? i.id : null,
      pending: null, subagents: [], todos: [], steps: 0, tool: "", toolDetail: "", turnStart: null, usage: null,
    }));
    return [...linked, ...plain];
  }, [infos, sInfos]);

  useEffect(() => { setFocused((f) => (f && !infos.some((i) => i.id === f) ? null : f)); }, [infos]);

  const addPane = useCallback((agent: AgentKind, cwd: string) => { paneCreate(agent, cwd).then(setFocused, console.error); }, []);
  const closePane = useCallback((id: string) => { paneClose(id).catch(console.error); }, []);
  const focusPaneInfo = useCallback((info: PaneInfo) => {
    if (info.window === WINDOW) setFocused(info.id);
    else paneFocus(info.id).then(() => windowFocus(info.window)).catch(console.error);
  }, []);
  const focusSession = useCallback((sessionId: string) => {
    const s = sInfosRef.current.find((x) => x.sessionId === sessionId);
    if (!s) {
      const info = infosRef.current.find((i) => i.id === sessionId);
      if (info) focusPaneInfo(info);
      return;
    }
    const info = s.paneId ? infosRef.current.find((i) => i.id === s.paneId) : undefined;
    if (info) focusPaneInfo(info);
    else paneCreate("hermes", s.cwd, sessionId).then(setFocused, console.error);
  }, [focusPaneInfo]);
  const stop = useCallback((sessionId: string) => {
    const paneId = sInfosRef.current.find((x) => x.sessionId === sessionId)?.paneId ?? sessionId;
    paneWrite(paneId, "\x03").catch(console.error);
  }, []);
  const approve = useCallback((sessionId: string, allow: boolean) => {
    sessionApprove(sessionId, allow).catch(() => focusSession(sessionId));
  }, [focusSession]);

  return { now, sessions, panes, focusedPaneId, focusPane: setFocused, focusSession, addPane, closePane, approve, stop, stopped: stoppedNone };
}
