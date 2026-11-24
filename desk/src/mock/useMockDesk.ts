import { useCallback, useEffect, useState } from "react";
import type { AgentKind, Pane, PaneView, Session } from "../lib/types";
import { setPaneGraph } from "../lib/paneGraph";
import type { SubagentLive } from "../lib/chatSession";
import { folderName, mockPanes, mockSessions } from "./sessions";

const TOOLS: [string, string][] = [["read_file", "src/app.ts"], ["terminal", "npm test"], ["patch", "src/app.ts"]];
const sec = () => Math.floor(Date.now() / 1000);
let seq = 100;

// Sample graph for pane p2 (session s2) so the dock can be reviewed in the browser.
const mk = (id: string, delegationId: string, index: number, count: number, goal: string, model: string, o: Partial<SubagentLive>): SubagentLive =>
  ({ id, depth: 0, delegationId, index, count, goal, model, status: "running", tool: "", toolPreview: "", toolCount: 0, startAt: Date.now() - 80_000, ...o });
function seedGraph() {
  setPaneGraph("p2", {
    subagents: [
      mk("m1", "d1", 0, 3, "로그인 테스트 원인 찾기", "claude-sonnet-4", { status: "done", toolCount: 6, durationSec: 80, summary: "토큰 만료 시간이 초 단위가 아니라 밀리초로 비교되고 있었습니다.", tokens: { in: 12400, out: 2100 }, outputTail: [{ tool: "read_file", preview: "src/auth/token.ts", isError: false }, { tool: "terminal", preview: "npm test -- auth", isError: false }] }),
      mk("m2", "d1", 1, 3, "API 응답 스키마 점검", "claude-sonnet-4", { tool: "terminal", toolPreview: "npm test", toolCount: 3 }),
      mk("m2a", "d1a", 0, 2, "스키마 필드 대조", "claude-haiku-4", { parentId: "m2", depth: 1, tool: "read_file", toolPreview: "api/schema.json", toolCount: 2 }),
      mk("m2b", "d1a", 1, 2, "응답 예시 수집", "gpt-5-mini", { parentId: "m2", depth: 1, status: "done", toolCount: 4, durationSec: 27, tokens: { in: 5200, out: 800 } }),
      mk("m2b1", "d1b", 0, 1, "예시 JSON 검증", "claude-haiku-4", { parentId: "m2b", depth: 2, tool: "terminal", toolPreview: "jq . examples/*.json", toolCount: 1 }),
      mk("m3", "d1", 2, 3, "문서 링크 검사", "gpt-5-mini", { status: "starting", startAt: null }),
      mk("m4", "d2", 0, 2, "린트 오류 수정", "claude-sonnet-4", { status: "failed", toolCount: 2, durationSec: 41, tokens: { in: 3000, out: 400 }, outputTail: [{ tool: "terminal", preview: "eslint: 12 problems", isError: true }] }),
      mk("m5", "d2", 1, 2, "타입 오류 수정", "claude-sonnet-4", { tool: "patch", toolPreview: "src/app.ts", toolCount: 1 }),
    ],
    background: [{ taskId: "bg_a1b2c3", text: "빌드 로그에서 경고만 추려 주세요", status: "running", startedAt: Date.now() - 45_000 }],
  });
}

export function useMockDesk(_hermesView?: PaneView) {
  const [now, setNow] = useState(sec);
  const [sessions, setSessions] = useState<Session[]>(mockSessions);
  const [panes, setPanes] = useState<Pane[]>(mockPanes);
  const [stopped, setStopped] = useState<Record<string, number>>({}); // per-session stop counter; terminals print "중지됨" on change
  const [focusedPaneId, setFocused] = useState<string | null>(mockPanes[0]?.id ?? null);

  useEffect(() => { seedGraph(); return () => setPaneGraph("p2", { subagents: [], background: [] }); }, []);
  useEffect(() => {
    let tick = 0;
    const id = setInterval(() => {
      tick++;
      const t = sec();
      setNow(t);
      // 가짜 세션이 검토 중에 "응답 없음"으로 바뀌지 않도록 활동 시각을 계속 갱신 (s8은 응답 없음 예시)
      // 실행 중인 세션은 토큰이 조금씩 늘어난다
      setSessions((all) => all.map((s) => {
        if (s.sessionId === "s8" || s.state === "closed") return s;
        const live = s.usage && (s.state === "running" || s.state === "thinking" || s.state === "tool");
        const usage = live ? { ...s.usage!, input: s.usage!.input + 40 + (tick % 7) * 10, output: s.usage!.output + 12 + (tick % 5) * 4, cacheRead: s.usage!.cacheRead + 120, apiCalls: s.usage!.apiCalls + (tick % 6 === 0 ? 1 : 0) } : s.usage;
        return { ...s, seen: t, usage };
      }));
      const patch = (sid: string, f: (s: Session) => Partial<Session>) =>
        setSessions((all) => all.map((s) => (s.sessionId === sid ? { ...s, ...f(s) } : s)));
      if (tick % 8 === 0)
        patch("s2", (s) => {
          if (s.state !== "tool") return {};
          const i = TOOLS.findIndex(([n, dt]) => n === s.tool && dt === s.toolDetail);
          const [tool, toolDetail] = TOOLS[(i + 1) % TOOLS.length];
          return { steps: s.steps + 1, tool, toolDetail, seen: t };
        });
      if (tick % 12 === 0) patch("s3", (s) => (s.state === "thinking" || s.state === "tool" ? { state: s.state === "thinking" ? "tool" : "thinking", since: t, seen: t } : {}));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const addPaneFor = useCallback((agent: AgentKind, cwd: string, sessionId: string | null, branch?: string | null): string => {
    const id = `p${++seq}`;
    setPanes((p) => [...p, { id, agent, cwd, sessionId, title: folderName(cwd), branch: branch ?? null }]);
    return id;
  }, []);

  const focusSession = useCallback((sessionId: string) => {
    const s = sessions.find((x) => x.sessionId === sessionId);
    if (!s) return;
    if (s.paneId) return setFocused(s.paneId);
    const id = addPaneFor(s.agent, s.cwd, s.sessionId, s.branch);
    setSessions((all) => all.map((x) => (x.sessionId === sessionId ? { ...x, paneId: id } : x)));
    setFocused(id);
  }, [sessions, addPaneFor]);

  const addPane = useCallback((agent: AgentKind, cwd: string, _view?: PaneView) => setFocused(addPaneFor(agent, cwd, null)), [addPaneFor]);

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

  const stop = useCallback((sessionId: string) => {
    const t = sec();
    setSessions((all) =>
      all.map((s) => (s.sessionId === sessionId ? { ...s, state: "idle", since: t, seen: t, turnStart: null, tool: "", toolDetail: "" } : s)));
    setStopped((m) => ({ ...m, [sessionId]: (m[sessionId] ?? 0) + 1 }));
  }, []);

  return { now, restored: true, sessions, panes, focusedPaneId, focusPane: setFocused, focusSession, addPane, closePane, approve, stop, stopped };
}
