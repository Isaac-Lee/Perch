import { useCallback, useEffect, useState } from "react";
import type { AgentKind, Pane, Session } from "../lib/types";
import { folderName, mockPanes, mockSessions } from "./sessions";

const TOOLS: [string, string][] = [["read_file", "src/app.ts"], ["terminal", "npm test"], ["patch", "src/app.ts"]];
const sec = () => Math.floor(Date.now() / 1000);
let seq = 100;

export function useMockDesk() {
  const [now, setNow] = useState(sec);
  const [sessions, setSessions] = useState<Session[]>(mockSessions);
  const [panes, setPanes] = useState<Pane[]>(mockPanes);
  const [focusedPaneId, setFocused] = useState<string | null>(mockPanes[0]?.id ?? null);

  useEffect(() => {
    let tick = 0;
    const id = setInterval(() => {
      tick++;
      const t = sec();
      setNow(t);
      // 가짜 세션이 검토 중에 "응답 없음"으로 바뀌지 않도록 활동 시각을 계속 갱신 (s8은 응답 없음 예시)
      setSessions((all) => all.map((s) => (s.sessionId === "s8" || s.state === "closed" ? s : { ...s, seen: t })));
      const patch = (sid: string, f: (s: Session) => Partial<Session>) =>
        setSessions((all) => all.map((s) => (s.sessionId === sid ? { ...s, ...f(s) } : s)));
      if (tick % 8 === 0)
        patch("s2", (s) => {
          const i = TOOLS.findIndex(([n, dt]) => n === s.tool && dt === s.toolDetail);
          const [tool, toolDetail] = TOOLS[(i + 1) % TOOLS.length];
          return { steps: s.steps + 1, tool, toolDetail, seen: t };
        });
      if (tick % 12 === 0) patch("s3", (s) => ({ state: s.state === "thinking" ? "tool" : "thinking", since: t, seen: t }));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const addPaneFor = useCallback((agent: AgentKind, cwd: string, sessionId: string | null): string => {
    const id = `p${++seq}`;
    setPanes((p) => [...p, { id, agent, cwd, sessionId, title: folderName(cwd) }]);
    return id;
  }, []);

  const focusSession = useCallback((sessionId: string) => {
    const s = sessions.find((x) => x.sessionId === sessionId);
    if (!s) return;
    if (s.paneId) return setFocused(s.paneId);
    const id = addPaneFor(s.agent, s.cwd, s.sessionId);
    setSessions((all) => all.map((x) => (x.sessionId === sessionId ? { ...x, paneId: id } : x)));
    setFocused(id);
  }, [sessions, addPaneFor]);

  const addPane = useCallback((agent: AgentKind, cwd: string) => setFocused(addPaneFor(agent, cwd, null)), [addPaneFor]);

  const closePane = useCallback((paneId: string) => {
    setPanes((p) => p.filter((x) => x.id !== paneId));
    setSessions((all) => all.map((s) => (s.paneId === paneId ? { ...s, paneId: null } : s)));
    setFocused((f) => (f === paneId ? null : f));
  }, []);

  const approve = useCallback((sessionId: string, allow: boolean) => {
    void allow; // mock: both choices resume the session
    const t = sec();
    setSessions((all) =>
      all.map((s) => (s.sessionId === sessionId ? { ...s, pending: null, state: "thinking", since: t, seen: t, turnStart: s.turnStart ?? t } : s)));
  }, []);

  return { now, sessions, panes, focusedPaneId, focusPane: setFocused, focusSession, addPane, closePane, approve };
}
