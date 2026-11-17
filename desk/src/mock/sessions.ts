import type { Pane, Session } from "../lib/types";

export const T0 = Math.floor(Date.now() / 1000);
const base: Pick<Session, "pending" | "subagents" | "todos" | "steps" | "tool" | "toolDetail" | "turnStart" | "paneId"> = { pending: null, subagents: [], todos: [], steps: 0, tool: "", toolDetail: "", turnStart: null, paneId: null };

const LONG_PROMPT =
  "src/ 아래의 모든 모듈에서 deprecated 된 설정 로더를 새 로더로 교체하고, 기존 테스트가 깨지지 않도록 호환 계층을 유지한 채 문서와 변경 로그까지 함께 정리해 주세요. 마이그레이션 중에 발견되는 순환 참조는 별도 이슈로 남겨 주세요.";
const LONG_ARG = "src/config/loaders/legacy/" + "very-long-directory-name/".repeat(8) + "settings.generated.ts";

export const mockSessions: Session[] = [
  { ...base, agent: "hermes", sessionId: "s1", cwd: "D:\\ysl\\st-alpha", repoRoot: "D:\\ysl\\st-alpha", branch: "main", state: "approval", since: T0 - 120, seen: T0 - 5,
    prompt: "빌드 산출물을 정리하고 다시 빌드해 주세요", pending: { kind: "approval", id: "a1", text: "rm -rf build/ 실행 허용?" }, paneId: "p1" },
  { ...base, agent: "hermes", sessionId: "s2", cwd: "D:\\ysl\\st-alpha", repoRoot: "D:\\ysl\\st-alpha", branch: "feature/login", state: "tool", since: T0 - 250, seen: T0 - 2,
    tool: "terminal", toolDetail: "npm test", steps: 3, turnStart: T0 - 248, prompt: "실패하는 테스트를 고쳐 주세요", paneId: "p2",
    subagents: [{ id: "g1", role: "leaf", goal: "로그 분석", start: T0 - 60 }, { id: "g2", role: "leaf", goal: "테스트 실패 원인 찾기", start: T0 - 30 }],
    todos: [{ text: "빌드 설정 수정", status: "done" }, { text: "테스트 실행", status: "in_progress" }, { text: "배포 스크립트 점검", status: "pending" }] },
  { ...base, agent: "opencode", sessionId: "s3", cwd: "D:\\ysl\\devops-lecture", repoRoot: "D:\\ysl\\devops-lecture", branch: "main", state: "thinking", since: T0 - 12, seen: T0 - 1,
    tool: "read_file", toolDetail: LONG_ARG, steps: 5, turnStart: T0 - 90, prompt: "강의 자료의 CI 예제를 최신 버전으로 맞춰 주세요", paneId: "p3" },
  { ...base, agent: "hermes", sessionId: "s4", cwd: "D:\\ysl\\devops-lecture", repoRoot: "D:\\ysl\\devops-lecture", branch: "feature/k8s-manifests", state: "question", since: T0 - 300, seen: T0 - 20,
    prompt: "쿠버네티스 배포 매니페스트를 만들어 주세요", pending: { kind: "question", id: "q1", text: "배포 대상 네임스페이스는?" }, paneId: "p4" },
  { ...base, agent: "hermes", sessionId: "s5", cwd: "D:\\a\\app", repoRoot: "D:\\a\\app", branch: "main", state: "idle", since: T0 - 90, seen: T0 - 90, prompt: "로그인 화면 문구를 정리했습니다", paneId: "p5" },
  { ...base, agent: "opencode", sessionId: "s6", cwd: "D:\\b\\app", repoRoot: "D:\\b\\app", branch: "develop", state: "idle", since: T0 - 600, seen: T0 - 600, prompt: "API 응답 타입을 갱신했습니다" },
  { ...base, agent: "hermes", sessionId: "s7", cwd: "C:\\Users\\user", repoRoot: null, branch: null, state: "idle", since: T0 - 62, seen: T0 - 62, prompt: LONG_PROMPT, paneId: "p6" },
  { ...base, agent: "hermes", sessionId: "s8", cwd: "D:\\ysl\\st-alpha", repoRoot: "D:\\ysl\\st-alpha", branch: "main", state: "tool", since: T0 - 1500, seen: T0 - 900,
    tool: "terminal", toolDetail: "npm run lint", steps: 7, turnStart: T0 - 1500, prompt: "린트 오류를 모두 고쳐 주세요" },
  { ...base, agent: "hermes", sessionId: "s9", cwd: "D:\\ysl\\devops-lecture", repoRoot: "D:\\ysl\\devops-lecture", branch: "docs/readme", state: "closed", since: T0 - 7200, seen: T0 - 7200, prompt: "README 초안 작성" },
];

export const folderName = (cwd: string) => cwd.split(/[\\/]+/).filter(Boolean).at(-1) ?? cwd;

export const mockPanes: Pane[] = mockSessions
  .filter((s) => s.paneId)
  .map((s) => ({ id: s.paneId!, agent: s.agent, cwd: s.cwd, sessionId: s.sessionId, title: folderName(s.cwd), branch: s.branch }));

export const recentFolders = ["D:\\ysl\\st-alpha", "D:\\ysl\\devops-lecture", "D:\\a\\app"];
