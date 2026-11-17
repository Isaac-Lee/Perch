# Agent Desk UI 시제품 (1단계) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 가짜 데이터로 Agent Desk 화면(세션 패널 + 자동 격자 분할 칸)을 브라우저에서 띄워 사용자가 확인할 수 있게 한다.

**Architecture:** `desk/`에 Vite + React + TypeScript 앱을 만든다. 이 단계에는 Tauri와 Rust를 넣지 않는다. Tauri 셸은 2단계에서 감싼다. 순수 로직(격자, 묶음, 정렬, 시간 표시)은 `src/lib/`에 두고 Vitest로 테스트한다. 화면은 `src/mock/`의 가짜 세션 데이터와 가짜 터미널 출력으로 그린다.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, `@xterm/xterm` + `@xterm/addon-fit`, `lucide-react`, `thinking-orbs` (libraries.dev)

**Spec:** `docs/superpowers/specs/2026-11-17-agent-desk-design.md` (5.1 상태 형식, 5.5 격자, 6 화면, 9 결정 사항)

## Global Constraints

- 런타임 네트워크 접속 금지: CDN 폰트, 원격 이미지, 원격 스크립트를 쓰지 않는다. 모든 것을 번들에 넣는다.
- 의존성은 Tech Stack에 있는 것만 쓴다. 다른 UI 라이브러리(MUI, shadcn, Tailwind 등)는 추가하지 않고, 스타일은 CSS 변수와 CSS Modules 또는 일반 CSS로 쓴다.
- 다크 테마만 만든다.
- 글꼴:
  - UI: `"Segoe UI", "Malgun Gothic", "Apple SD Gothic Neo", system-ui, sans-serif`
  - 터미널: `"D2Coding", "Cascadia Mono", Consolas, Menlo, monospace`
- unslop 규칙을 지킨다.
  - 간격은 4px 격자 (4/8/12/16/20/24)
  - 배경과 텍스트는 중립 회색 단계. 텍스트 역할은 primary, secondary, muted 3개
  - 강조색 1개
  - 테두리는 1px, 불투명도 6~10%
  - 글꼴 굵기는 400과 500만
  - 그라데이션, 글로우, 그림자 장식, 이모지 아이콘 금지
  - 아이콘은 lucide 16px, strokeWidth 1.5
  - 숫자는 `font-variant-numeric: tabular-nums`
  - 문구에 느낌표를 쓰지 않는다. 짧은 라벨 끝에 마침표를 찍지 않는다
  - `transition: all` 금지
- 애니메이션은 세 곳만 쓴다.
  - 패널: 작업중 계열 상태 점의 깜빡임 (opacity 1 → 0.35, 1.2s ease-in-out, 무한 반복)
  - 칸 상단: 생각 중 표시
  - 칸 하단: 진행 줄 로더 (`thinking-orbs`)
  - 그 외에는 hover 색 변화 외의 움직임이 없어야 한다.
- 상태 색:
  - 작업 중 계열(running, thinking, tool): 초록 계열
  - 승인대기, 질문대기: 경고색(주황 또는 빨강 계열 하나)
  - 답변대기(idle): 노랑 계열
  - 종료, 응답 없음: muted 회색
- 패널 너비는 260px이고 접을 수 있다.
- 화면 문구는 한국어로 쓴다.

## Review Focus

- 칸 0개: 빈 격자 대신 "칸 없음 · + 버튼으로 새 칸" 안내가 나와야 한다. `gridLayout(0)` 테스트로 확인한다.
- 칸이 많을 때(9개 이상): 모든 칸이 화면 안에 보이고 겹치지 않아야 한다. `gridLayout(9)`, `gridLayout(10)` 테스트로 확인한다.
- 같은 이름의 git 저장소 두 개(`D:\a\app`, `D:\b\app`): 묶음 이름이 겹치지 않아야 한다(`app (a)`, `app (b)`). `groupSessions` 테스트로 확인한다.
- cwd가 빈 세션: "공통 작업 공간"으로 묶여야 한다. `groupSessions` 테스트로 확인한다.
- 긴 프롬프트나 도구 인자(200자 이상): 줄바꿈 없이 말줄임(…)으로 잘려야 하고 레이아웃이 깨지지 않아야 한다. 가짜 데이터에 긴 값을 하나 넣어 눈으로 확인한다.

---

### Task 1: 프로젝트 골격 + 순수 로직

**Files:**
- Create: `desk/package.json`, `desk/vite.config.ts`, `desk/tsconfig.json`, `desk/index.html`, `desk/src/main.tsx`
- Create: `desk/src/lib/types.ts`
- Create: `desk/src/lib/grid.ts`, `desk/src/lib/grid.test.ts`
- Create: `desk/src/lib/groups.ts`, `desk/src/lib/groups.test.ts`
- Create: `desk/src/lib/format.ts`, `desk/src/lib/format.test.ts`
- Modify: `.gitignore` (`desk/node_modules/`, `desk/dist/`를 추가)

**Interfaces (Produces):**

```ts
// types.ts — 설계 문서 5.1과 같은 필드
export type AgentKind = "hermes" | "opencode" | "shell";
export type SessionStateName = "running" | "thinking" | "tool" | "approval" | "question" | "idle" | "closed";
export interface Subagent { id: string; role: string; goal: string; start: number; tool?: string }
export interface Todo { text: string; status: "pending" | "in_progress" | "done" }
export interface Pending { kind: "approval" | "question"; id: string; text: string }
export interface Session {
  agent: AgentKind; sessionId: string; cwd: string; repoRoot: string | null;
  state: SessionStateName; since: number; turnStart: number | null; steps: number;
  tool: string; toolDetail: string; prompt: string; pending: Pending | null;
  subagents: Subagent[]; todos: Todo[]; seen: number; paneId: string | null;
}
export interface Pane { id: string; agent: AgentKind; cwd: string; sessionId: string | null; title: string }
export interface Group { key: string; label: string; isCommon: boolean; sessions: Session[]; recent: Session[] }

// grid.ts
export interface Cell { col: number; row: number; colSpan: number }
export function gridLayout(n: number): { cols: number; rows: number; cells: Cell[] }

// groups.ts
export const COMMON_LABEL = "공통 작업 공간";
export const MY_TURN: SessionStateName[] = ["approval", "question", "idle"];
export function displayState(s: Session, now: number): SessionStateName | "stale";
export function groupSessions(sessions: Session[], now: number): Group[];

// format.ts
export function fmtElapsed(sec: number): string;
export function stateLabel(s: SessionStateName | "stale"): string;
```

- [ ] **Step 1: 골격 만들기**
  - `npm create vite@latest desk -- --template react-ts`로 만든다. Vite 기본 데모 파일(App.css, assets, 로고 등)은 지운다.
  - 의존성을 설치한다: `npm i @xterm/xterm @xterm/addon-fit lucide-react thinking-orbs`, `npm i -D vitest`
  - `package.json` scripts에 `"test": "vitest run"`을 추가한다.
  - `thinking-orbs`의 README(`node_modules/thinking-orbs/README.md` 또는 패키지 export)를 읽고, 사용 가능한 컴포넌트 이름과 props를 `desk/NOTES.md`에 5줄 이내로 적는다. Task 2가 이 메모를 쓴다.
- [ ] **Step 2: 실패하는 테스트 작성**

```ts
// grid.test.ts
expect(gridLayout(0)).toEqual({ cols: 0, rows: 0, cells: [] });
expect(gridLayout(1)).toMatchObject({ cols: 1, rows: 1 });
expect(gridLayout(2)).toMatchObject({ cols: 2, rows: 1 });
expect(gridLayout(3)).toMatchObject({ cols: 2, rows: 2 });
expect(gridLayout(3).cells[2]).toEqual({ col: 0, row: 1, colSpan: 2 }); // 마지막 행 빈칸은 앞 칸이 넓혀 채움
expect(gridLayout(4)).toMatchObject({ cols: 2, rows: 2 });
expect(gridLayout(5)).toMatchObject({ cols: 3, rows: 2 });
expect(gridLayout(6)).toMatchObject({ cols: 3, rows: 2 });
expect(gridLayout(8)).toMatchObject({ cols: 3, rows: 3 });
expect(gridLayout(9)).toMatchObject({ cols: 3, rows: 3 });
expect(gridLayout(10)).toMatchObject({ cols: 4, rows: 3 });
// 모든 n(1..16)에 대해: cells.length === n, 같은 행의 colSpan 합 === cols
```

```ts
// groups.test.ts — now = 1_000_000
// 1) repoRoot "D:\\a\\app"와 "D:\\b\\app" → 라벨 "app (a)", "app (b)", key는 repoRoot 전체 경로
// 2) repoRoot null → key "common", label "공통 작업 공간", isCommon true
// 3) 묶음 순서: MY_TURN 상태 세션이 있는 묶음이 먼저. 묶음 안 순서는 approval, question, idle, (running|thinking|tool), stale, closed. 같은 상태끼리는 since가 오래된 것이 먼저
// 4) displayState: state "tool"인데 now - seen > 600 → "stale"
// 5) recent: state "closed"이거나 now - seen > 86400인 세션은 sessions가 아니라 recent에 들어간다. now - seen > 604800은 결과에서 빠진다. 단 paneId가 있는 세션은 항상 sessions에 들어간다
```

```ts
// format.test.ts
expect(fmtElapsed(8)).toBe("8초");
expect(fmtElapsed(248)).toBe("4분 8초");
expect(fmtElapsed(3725)).toBe("1시간 2분");
expect(stateLabel("approval")).toBe("승인대기");
// 라벨: running 작업중, thinking 생각중, tool 실행중, approval 승인대기, question 질문대기, idle 답변대기, closed 종료, stale 응답 없음
```

- [ ] **Step 3: 테스트 실행 → 실패 확인** — 실행: `cd desk && npm test`. 기대 결과: 함수가 없어서 FAIL.
- [ ] **Step 4: `grid.ts`, `groups.ts`, `format.ts` 구현**
  - 격자: cols = ⌈√n⌉, rows = ⌈n/cols⌉. 마지막 행에 남는 자리는 마지막 행 칸들이 colSpan으로 균등하게 나눠 채운다. 나머지 colSpan은 마지막 칸이 갖는다.
  - 라벨 중복은 repoRoot의 상위 폴더 이름을 괄호로 붙여 구분한다.
- [ ] **Step 5: 테스트 실행 → 통과 확인** — 실행: `npm test`. 기대 결과: 모두 PASS.
- [ ] **Step 6: 커밋** — `git add desk .gitignore && git commit -m "desk: scaffold + grid/group/format logic"`

### Task 2: 화면 (가짜 데이터)

**Files:**
- Create: `desk/src/mock/sessions.ts`, `desk/src/mock/terminal.ts`, `desk/src/mock/useMockDesk.ts`
- Create: `desk/src/styles/tokens.css`, `desk/src/App.tsx`, `desk/src/App.css`
- Create: `desk/src/components/Sidebar.tsx`, `SessionRow.tsx`, `PaneGrid.tsx`, `Pane.tsx`, `PaneHeader.tsx`, `PaneFooter.tsx`, `TerminalView.tsx`, `NewPaneMenu.tsx` (각각 같은 이름의 `.css`를 쓸 수 있다)

**Interfaces:**
- Consumes: Task 1의 `types.ts`, `gridLayout`, `groupSessions`, `displayState`, `fmtElapsed`, `stateLabel`, `desk/NOTES.md`(thinking-orbs 사용법)
- Produces (`useMockDesk.ts`):

```ts
export function useMockDesk(): {
  now: number;                       // 1초마다 갱신
  sessions: Session[]; panes: Pane[]; focusedPaneId: string | null;
  focusSession(sessionId: string): void;   // 열린 칸이면 focus. 아니면 새 Pane 추가 후 focus
  addPane(agent: AgentKind, cwd: string): void;
  closePane(paneId: string): void;
  approve(sessionId: string, allow: boolean): void; // 가짜: pending 제거, state→thinking
}
```

- [ ] **Step 1: 가짜 데이터 (`mock/sessions.ts`)** — 다음 세션을 만든다.
  - repo `D:\ysl\todo-api`
    - hermes 승인대기. pending text는 "rm -rf build/ 실행 허용?"
    - hermes 실행중. tool "terminal", toolDetail "npm test", steps 3, turnStart는 4분 전
      - 서브에이전트 2개: leaf "로그 분석" 1분, leaf "테스트 실패 원인 찾기" 30초
      - todos 3개: done, in_progress, pending 하나씩
  - repo `D:\ysl\devops-lecture`
    - opencode 생각중
    - hermes 질문대기. 질문 "배포 대상 네임스페이스는?"
  - repo `D:\a\app`, `D:\b\app`: 이름이 겹치는 경우. 각각 답변대기 1개
  - 공통 작업 공간: hermes 답변대기 1개. prompt는 200자 이상
  - 응답 없음(seen 15분 전, state tool) 1개
  - 최근 묶음: 종료된 세션 1개
  - 칸은 처음에 6개가 열린 상태이고, 일부 세션과 연결돼 있다.
- [ ] **Step 2: 가짜 시간 흐름 (`useMockDesk.ts`)**
  - `now`는 1초마다 갱신한다.
  - 8초마다 실행중 세션 하나의 steps를 +1하고 tool/toolDetail을 순환시킨다: "read_file src/app.ts" → "terminal npm test" → "patch src/app.ts".
  - 12초마다 opencode 세션이 thinking과 tool 사이를 오간다.
- [ ] **Step 3: 가짜 터미널 (`mock/terminal.ts`, `TerminalView.tsx`)**
  - xterm 인스턴스에 에이전트별 고정 출력(15~30줄, ANSI 색 포함)을 쓴다. hermes 예: 프롬프트, 사용자 입력, 도구 실행 로그.
  - addon-fit으로 칸 크기에 맞추고, ResizeObserver로 다시 맞춘다.
  - 키 입력은 화면에 그대로 에코만 한다.
- [ ] **Step 4: 패널 (`Sidebar.tsx`, `SessionRow.tsx`)**
  - 상단: "세션", 요약(작업중 N · 내 차례 N), 접기 버튼
  - 묶음 제목: 라벨, 세션 수(작은 회색 숫자). 공통 작업 공간은 마지막이다.
  - 세션 행:
    - 상태 점(작업중 계열만 깜빡임), 에이전트 이름, 상태 라벨, 경과시간
    - 서브에이전트가 있으면 "에이전트 N"을 표시한다.
    - 아래 줄에 prompt를 말줄임으로 보여준다.
    - 승인대기면 [허용] [거절] 버튼과 pending text
    - 서브에이전트 목록: `└ role goal 경과`
    - todos: 체크 아이콘 3종(lucide `CircleCheck`, `CircleDot`, `Circle`) + text
  - 행을 클릭하면 `focusSession`을 호출한다. 포커스된 칸의 세션 행은 surface 한 단계 밝게 + 헤어라인으로 표시한다.
  - "최근" 묶음은 기본으로 접혀 있다.
- [ ] **Step 5: 격자 (`PaneGrid.tsx`, `Pane.tsx`)**
  - CSS grid로 `gridLayout(panes.length)`를 그대로 반영한다. 칸 사이 간격은 1px 헤어라인이다.
  - 칸이 0개면 Review Focus의 안내를 띄운다.
  - 포커스된 칸은 테두리를 강조색 1px로 표시한다.
  - 칸을 클릭하면 포커스된다. 칸 헤더의 닫기 버튼(lucide `X`)은 `closePane`을 호출한다.
- [ ] **Step 6: 칸 상단과 하단**
  - `PaneHeader`: 에이전트 · 폴더명 · 닫기 버튼.
    - 생각 중이면 오른쪽에 `thinking-orbs`(NOTES.md에 적은 작은 변형) + "생각 중 12초"
    - 승인대기나 질문대기면 헤더 배경이 경고색 저채도로 바뀌고 "승인 필요 · rm -rf build/ 실행 허용?"을 보여준다
  - `PaneFooter`: 작업중 계열일 때만 보인다. `thinking-orbs` 로더 + "terminal: npm test · 3단계 · 4분 8초"
    - 단계 수는 steps, 시간은 now - turnStart
    - 답변대기에서는 "답변 대기 · 1분 2초"를 회색으로 보여준다
- [ ] **Step 7: 새 칸 메뉴 (`NewPaneMenu.tsx`)**
  - 창 상단 오른쪽 [+]를 누르면 에이전트 3개(Hermes, OpenCode, 셸)와 최근 폴더 3개 목록이 나온다. 하나를 고르면 `addPane`을 호출한다.
  - 상단 바에는 앱 이름 "Agent Desk", 칸 수, [+]만 둔다.
- [ ] **Step 8: 실행 확인**
  - `npm run dev`로 띄운 뒤 아래 항목을 확인하고, 결과를 보고에 적는다.
    - 1600×1000에서 패널과 칸 6개(3×2)가 보인다
    - 승인 버튼을 누르면 상태가 바뀐다
    - 닫힌 세션을 클릭하면 칸이 추가되고 격자가 재배치된다
    - 칸을 9개로 늘려도 화면 안에 보인다
  - `npm test`와 `npx tsc --noEmit`이 통과해야 한다.
- [ ] **Step 9: 커밋** — `git add desk && git commit -m "desk: UI prototype with mock data"`

### Task 3: README 스크린샷 (감독자 수행)

- [ ] 개발 서버를 1600×1000 크기로 띄운 상태에서 Edge headless로 스크린샷을 찍는다. 저장 위치는 `docs/images/desk-prototype.png`다.
- [ ] README의 Agent Desk 요약 아래에 스크린샷과 실행 방법(`cd desk && npm install && npm run dev`)을 넣는다.
- [ ] 커밋하고 push한다.

### Task 4: 사용자 검토 1차 반영

사용자 요청 4가지와 감독자가 정한 구현 방식이다.

1. **스크롤바:** 기본은 숨긴다.
   - 스크롤하는 동안에만 얇은 오버레이 스크롤바(6px, 둥근 thumb, rgba(255,255,255,0.18))를 보여준다. 멈추고 800ms가 지나면 사라진다.
   - 적용 대상: 패널, 터미널(`.xterm-viewport`), 메뉴.
   - 패널은 아래에 내용이 더 있으면 하단에 "아래에 더 있음" 줄(아이콘 `ChevronDown` + muted 텍스트, 헤어라인 위쪽 테두리)을 표시한다. 끝까지 내리면 숨긴다.
   - 구현: `useScrollReveal(ref)` 훅. scroll 이벤트가 오면 `is-scrolling` 클래스를 붙이고, 타이머로 뗀다.
2. **입력 영역 구분 (감독자 결정):** 별도 입력창을 만들지 않는다.
   - 앱이 따로 입력창을 만들면 hermes/opencode의 자동완성, 슬래시 명령, 화살표 메뉴를 잃는다.
   - 대신 다음 세 가지로 구분한다.
     - 포커스된 칸을 확실하게 표시한다: 강조색 테두리, 헤더 배경 한 단계 밝게, 헤더 왼쪽에 "입력 중" 표시.
     - 터미널의 입력 줄(커서가 있는 줄)에 배경 띠를 깐다. xterm decoration API를 쓰고, 포커스된 칸에서만 표시한다.
     - 가짜 터미널 출력 마지막에 에이전트의 실제 입력 프롬프트 모양을 넣는다(구분선 + `❯ ` + 커서).
3. **브랜치:**
   - `Session`과 `Pane`에 `branch: string | null`을 추가한다.
   - 칸 헤더에 `폴더 · 브랜치`를 표시한다. 아이콘은 `GitBranch` 12~14px이다.
   - 패널의 세션 행에 브랜치를 muted로 표시한다.
   - 가짜 데이터: 같은 저장소의 다른 브랜치 세션(main, feature/login 등)을 넣는다.
   - 실제 값은 2단계에서 `.git/HEAD`로 읽는다.
4. **터미널 글꼴 설정:**
   - 상단 바에 설정 버튼(`Settings` 아이콘)을 둔다. 누르면 작은 설정 패널이 나온다.
     - 터미널 글꼴: 목록 + 직접 입력
     - 글자 크기: 10~24, 숫자 입력과 −/+ 버튼
   - 바꾸면 모든 칸의 xterm에 바로 적용하고 fit을 다시 계산한다.
   - 저장: 지금은 localStorage에 저장한다. 2단계에서 Tauri 설정 파일로 옮긴다. localStorage 접근은 try/catch로 감싼다.
   - 기본값: 글꼴 "D2Coding", 크기 13.
   - D2Coding(SIL OFL 1.1, naver/d2codingfont)을 `desk/public/fonts/`에 넣고 @font-face로 로컬에서 불러온다. 라이선스 파일도 함께 넣는다. 한글 자간 문제를 이것으로 해결한다.
