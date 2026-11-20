import type { Pane, Session, Usage } from "../lib/types";

export const T0 = Math.floor(Date.now() / 1000);
const base: Pick<Session, "pending" | "subagents" | "todos" | "steps" | "tool" | "toolDetail" | "turnStart" | "paneId" | "usage"> = { pending: null, subagents: [], todos: [], steps: 0, tool: "", toolDetail: "", turnStart: null, paneId: null, usage: null };

const LONG_PROMPT =
  "src/ 아래의 모든 모듈에서 deprecated 된 설정 로더를 새 로더로 교체하고, 기존 테스트가 깨지지 않도록 호환 계층을 유지한 채 문서와 변경 로그까지 함께 정리해 주세요. 마이그레이션 중에 발견되는 순환 참조는 별도 이슈로 남겨 주세요.";
const LONG_ARG = "src/config/loaders/legacy/" + "very-long-directory-name/".repeat(8) + "settings.generated.ts";

const DAY = 86400;
const makeUsage = (model: string, input: number, output: number, cacheRead: number, cacheWrite: number, apiCalls: number, daysAgo: number, costUsd: number | null = null): Usage =>
  ({ model, input, output, cacheRead, cacheWrite, reasoning: Math.round(output * 0.3), apiCalls, costUsd, startedAt: T0 - Math.round(daysAgo * DAY) });
const Q8 = "qwen3:8b", QC = "qwen3-coder:32b", GO = "gpt-oss:20b";

const sessions0: Session[] = [
  { ...base, agent: "hermes", sessionId: "s1", cwd: "D:\\ysl\\todo-api", repoRoot: "D:\\ysl\\todo-api", branch: "main", state: "approval", since: T0 - 120, seen: T0 - 5,
    title: "빌드 산출물 정리", prompt: "빌드 산출물을 정리하고 다시 빌드해 주세요", pending: { kind: "approval", id: "a1", text: "rm -rf build/ 실행 허용?" }, paneId: "p1" },
  { ...base, agent: "hermes", sessionId: "s2", cwd: "D:\\ysl\\todo-api", repoRoot: "D:\\ysl\\todo-api", branch: "feature/login", state: "tool", since: T0 - 250, seen: T0 - 2,
    tool: "terminal", toolDetail: "npm test", steps: 3, turnStart: T0 - 248, title: "실패 테스트 수정", prompt: "실패하는 테스트를 고쳐 주세요", paneId: "p2",
    subagents: [{ id: "g1", role: "leaf", goal: "로그 분석", start: T0 - 60 }, { id: "g2", role: "leaf", goal: "테스트 실패 원인 찾기", start: T0 - 30 }],
    todos: [{ text: "빌드 설정 수정", status: "done" }, { text: "테스트 실행", status: "in_progress" }, { text: "배포 스크립트 점검", status: "pending" }] },
  { ...base, agent: "opencode", sessionId: "s3", cwd: "D:\\ysl\\devops-lecture", repoRoot: "D:\\ysl\\devops-lecture", branch: "main", state: "thinking", since: T0 - 12, seen: T0 - 1,
    tool: "read_file", toolDetail: LONG_ARG, steps: 5, turnStart: T0 - 90, title: "CI 예제 최신화", prompt: "강의 자료의 CI 예제를 최신 버전으로 맞춰 주세요", paneId: "p3" },
  { ...base, agent: "hermes", sessionId: "s4", cwd: "D:\\ysl\\devops-lecture", repoRoot: "D:\\ysl\\devops-lecture", branch: "feature/k8s-manifests", state: "question", since: T0 - 300, seen: T0 - 20,
    title: "쿠버네티스 매니페스트", prompt: "쿠버네티스 배포 매니페스트를 만들어 주세요", pending: { kind: "question", id: "q1", text: "배포 대상 네임스페이스는?" }, paneId: "p4" },
  { ...base, agent: "hermes", sessionId: "s5", cwd: "D:\\a\\app", repoRoot: "D:\\a\\app", branch: "main", state: "idle", since: T0 - 90, seen: T0 - 90, lastTurn: 38, title: "로그인 문구 정리", prompt: "로그인 화면 문구를 정리했습니다", paneId: "p5" },
  { ...base, agent: "opencode", sessionId: "s6", cwd: "D:\\b\\app", repoRoot: "D:\\b\\app", branch: "develop", state: "idle", since: T0 - 600, seen: T0 - 600, lastTurn: 95, title: "API 응답 타입 갱신", prompt: "API 응답 타입을 갱신했습니다", asks: true, ask: "응답 타입을 optional로 바꿀까요, 아니면 null을 허용할까요?" },
  { ...base, agent: "hermes", sessionId: "s7", cwd: "C:\\Users\\user", repoRoot: null, branch: null, state: "idle", since: T0 - 62, seen: T0 - 62, lastTurn: 154, prompt: LONG_PROMPT, paneId: "p6" },
  { ...base, agent: "hermes", sessionId: "s8", cwd: "D:\\ysl\\todo-api", repoRoot: "D:\\ysl\\todo-api", branch: "main", state: "tool", since: T0 - 1500, seen: T0 - 900,
    tool: "terminal", toolDetail: "npm run lint", steps: 7, turnStart: T0 - 1500, title: "린트 오류 수정", prompt: "린트 오류를 모두 고쳐 주세요" },
  { ...base, agent: "hermes", sessionId: "s9", cwd: "D:\\ysl\\devops-lecture", repoRoot: "D:\\ysl\\devops-lecture", branch: "docs/readme", state: "closed", since: T0 - 7200, seen: T0 - 7200, title: "README 초안", prompt: "README 초안 작성" },
  { ...base, agent: "hermes", sessionId: "s10", cwd: "D:\\ysl\\devops-lecture", repoRoot: "D:\\ysl\\devops-lecture", branch: "main", state: "idle", since: T0 - 3000, seen: T0 - 3000, prompt: "" },
];

const usages: Record<string, Usage> = {
  s1: makeUsage(QC, 182_000, 9_400, 410_000, 36_000, 14, 0.05),
  s2: makeUsage(QC, 420_000, 21_000, 1_150_000, 88_000, 31, 0.1),
  s3: makeUsage(GO, 96_000, 7_300, 210_000, 19_000, 9, 0.06),
  s4: makeUsage(Q8, 38_000, 2_800, 64_000, 6_500, 5, 0.2),
  s5: makeUsage(Q8, 12_400, 1_100, 0, 0, 3, 0.01),
  s6: makeUsage(GO, 8_900, 640, 22_000, 3_100, 2, 1.2),
  s7: makeUsage(Q8, 5_300, 900, 0, 0, 2, 0.02),
  s8: makeUsage(QC, 260_000, 14_000, 700_000, 52_000, 22, 1.5),
  s9: makeUsage(Q8, 41_000, 6_200, 90_000, 9_000, 8, 2.1, 0.42),
};
const extras: Session[] = [
  { ...base, agent: "hermes", sessionId: "x1", cwd: "D:\\ysl\\todo-api", repoRoot: "D:\\ysl\\todo-api", branch: "main", state: "closed", since: T0 - 3 * DAY, seen: T0 - 3 * DAY, title: "의존성 업데이트", prompt: "의존성 업데이트와 변경 로그 정리", usage: makeUsage(QC, 310_000, 18_000, 880_000, 70_000, 26, 3) },
  { ...base, agent: "opencode", sessionId: "x2", cwd: "D:\\ysl\\devops-lecture", repoRoot: "D:\\ysl\\devops-lecture", branch: "main", state: "closed", since: T0 - 4.5 * DAY, seen: T0 - 4.5 * DAY, title: "슬라이드 코드 점검", prompt: "슬라이드 예제 코드 점검", usage: makeUsage(GO, 74_000, 5_100, 150_000, 12_000, 7, 4.5) },
  { ...base, agent: "hermes", sessionId: "x3", cwd: "D:\\a\\app", repoRoot: "D:\\a\\app", branch: "main", state: "closed", since: T0 - 6 * DAY, seen: T0 - 6 * DAY, title: "가입 폼 검증", prompt: "회원가입 폼 검증 추가", usage: makeUsage(Q8, 52_000, 4_400, 120_000, 8_000, 9, 6) },
  { ...base, agent: "hermes", sessionId: "x4", cwd: "C:\\Users\\user", repoRoot: null, branch: null, state: "closed", since: T0 - 9 * DAY, seen: T0 - 9 * DAY, title: "환경 변수 정리", prompt: "환경 변수 정리", usage: makeUsage(Q8, 21_000, 2_000, 0, 0, 4, 9) },
  { ...base, agent: "hermes", sessionId: "x5", cwd: "D:\\b\\app", repoRoot: "D:\\b\\app", branch: "develop", state: "closed", since: T0 - 11 * DAY, seen: T0 - 11 * DAY, title: "빌드 캐시 조사", prompt: "빌드 캐시 문제 조사", usage: makeUsage(QC, 145_000, 8_200, 380_000, 30_000, 12, 11) },
  { ...base, agent: "opencode", sessionId: "x6", cwd: "D:\\ysl\\todo-api", repoRoot: "D:\\ysl\\todo-api", branch: "main", state: "closed", since: T0 - 13 * DAY, seen: T0 - 13 * DAY, title: "프로젝트 구조 점검", prompt: "초기 프로젝트 구조 점검", usage: makeUsage(GO, 33_000, 2_500, 60_000, 5_000, 5, 13) },
];

// ~80 older closed sessions over the past year (deterministic LCG) so the 1y chart looks realistic; sidebar drops them (> 7 days).
let seed = 20261117;
const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const ROOTS = ["D:\\ysl\\todo-api", "D:\\ysl\\devops-lecture", "D:\\a\\app", "D:\\b\\app"];
const MODELS = [Q8, QC, GO];
const history: Session[] = Array.from({ length: 80 }, (_, i) => {
  const daysAgo = 15 + rnd() * 350;
  const model = MODELS[Math.floor(rnd() * 3)];
  const scale = (model === QC ? 3 : model === GO ? 1.5 : 1) * (0.2 + rnd() * rnd() * 4);
  const root = rnd() < 0.15 ? null : ROOTS[Math.floor(rnd() * ROOTS.length)];
  const t = (n: number) => Math.round((n * scale) / 100) * 100;
  return { ...base, agent: rnd() < 0.3 ? "opencode" : "hermes", sessionId: `h${i + 1}`, cwd: root ?? "C:\\Users\\user", repoRoot: root, branch: root ? "main" : null, state: "closed",
    since: T0 - Math.round(daysAgo * DAY), seen: T0 - Math.round(daysAgo * DAY), title: `지난 작업 ${i + 1}`, prompt: `지난 작업 ${i + 1}`,
    usage: makeUsage(model, t(120_000), t(8_000), t(300_000), t(25_000), 2 + Math.floor(rnd() * 30), daysAgo) };
});

export const mockSessions: Session[] = [...sessions0.map((s) => ({ ...s, usage: usages[s.sessionId] ?? null })), ...extras, ...history];

export const folderName = (cwd: string) => cwd.split(/[\\/]+/).filter(Boolean).at(-1) ?? cwd;

export const mockPanes: Pane[] = mockSessions
  .filter((s) => s.paneId)
  .map((s) => ({ id: s.paneId!, agent: s.agent, cwd: s.cwd, sessionId: s.sessionId, title: folderName(s.cwd), branch: s.branch }));

export const recentFolders = ["D:\\ysl\\todo-api", "D:\\ysl\\devops-lecture", "D:\\a\\app"];
