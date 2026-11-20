# 서브에이전트·백그라운드 작업 그래프 보기 — 인계

다른 PC의 새 Claude Code 세션이 이 기능을 구현하도록 쓴 인계 문서다. 먼저 `docs/HANDOFF.md`(4~6절)와 `docs/VERSIONING.md`를 읽는다. 아래 "제안 설계"는 확정이 아니므로 구현 전에 사용자와 확인한다.

## 요청 (사용자, 2026-11-20)

- 세션별 상단 탭(칸 헤더, `desk/src/components/PaneHeader.tsx`)에, 그 세션에 서브에이전트나 백그라운드 작업이 생기면 별도 버튼이 생긴다. 누르면 그래프 창이 뜬다.
- 지금은 패널 행에 `N agents`와 `└` 줄로만 보인다(`SessionRow.tsx`). 사용자는 Hermes Ctrl+T처럼 몇 개가 떠 있고 각각 무엇을 하는지 한눈에 보는 그래프 보기를 원한다.

## 참고 이미지 (사용자 첨부 스크린샷 설명)

- 새 세션에서 사용자가 같은 이미지를 다시 첨부한다. 이미지 파일은 저장소에 없다.
- 어두운 배경이다. 노드는 1px 점선 테두리의 둥근 사각형이다.
- 노드 첫 줄은 속이 빈 점선 원 상태 아이콘과 굵은 제목이다. 제목이 길면 `…`로 자른다.
- 둘째 줄은 흐린 글씨의 `계획 4단계 · 시작 전`이다. 셋째 줄은 `opus·high (계획)` 같은 작은 모델 배지다.
- 노드는 행으로 놓인다. 위 행에 둘, 가운데 행에 둘, 맨 아래에 폭이 넓은 `보고·인계 대기` 노드 하나가 있다.
- 간선은 흐린 가는 직교선이고 꺾임이 둥글며 화살촉이 작다. 위에서 아래로 향하고, 여러 간선이 맨 아래 노드로 합쳐진다.

## 지금 있는 데이터

- 채팅 보기: `ChatState.subagents`(`desk/src/lib/chatSession.ts`)는 subagent_id별 `SubagentLive` 기록이다.
  - 필드: goal, model, status(starting/running/done/failed), tool, toolPreview, toolCount, startAt, durationSec, summary, tokens, outputTail, delegationId, index/count.
  - 출처는 게이트웨이 `subagent.*` 프레임이고, 처리는 같은 파일의 `subagentEvent`다. `delegate_task` 항목의 `subagentIds`가 자식 id를 가리킨다.
  - 이 라이브 세션에서 본 끝난 자식도 들어 있다. resume한 기록에는 없다.
- `desk/src/lib/liveSubagents.ts`: 칸 id별 "실행 중" 자식만 담는다(`setLiveSubagents`). `ChatView.tsx`가 넣고 `Sidebar.tsx`가 패널 행에 보여준다. 끝난 자식은 여기에 없으므로 그래프는 `ChatState.subagents`를 직접 써야 한다.
- 터미널(TUI) 칸: 훅 상태의 `subagents`는 비동기 위임에서 채워지지 않는다(HANDOFF에서 확인함). TUI 칸에는 서브에이전트 데이터가 없고 백그라운드 작업만 있다. 이 한계를 받아들이거나(버튼이 그 칸에서는 백그라운드 작업만 보여준다), 먼저 훅 이벤트를 조사한다. 조사 결과를 약속하지 않는다.
- 백그라운드 작업: 별도 `bg_` 세션이다(`isBackgroundId`, `desk/src/lib/groups.ts`). 부모 연결은 `Session.parentId`(훅의 `PERCH_PANE`)나 채팅의 `prompt.background` task_id(`chatTasks`)이고, `nestBackground`가 이를 묶는다. `Session` 객체로 state, prompt, since를 쓸 수 있다(`desk/src/lib/types.ts`).
- 중첩: 자식이 다시 자식을 만드는지(orchestrator와 leaf 역할)는 모른다. `desk/src/lib/__fixtures__/delegate.jsonl`의 프레임은 전부 `depth":0`이고 부모 id 필드는 없다. 먼저 한 단계(부모 세션 → 자식들)로 만들고, 실제 데이터에서 더 깊은 것이 보이면 확장한다.

## 제안 설계 (확정 아님)

- PaneHeader: 그 칸 세션에 서브에이전트(이 세션에서 본 것은 상태 무관)나 백그라운드 자식이 하나 이상 있으면 작은 버튼을 보인다. lucide `Network` 또는 `GitFork` 아이콘과 실행 중 개수(`3`), title은 "서브에이전트·백그라운드 작업 보기"다. 없으면 숨긴다.
- 클릭하면 칸 안 오버레이(또는 그리드 위 모달)로 그래프를 연다.
  - 루트 노드는 이 세션이다(제목, 상태).
  - 자식 노드는 서브에이전트(상태 아이콘, 목표, 모델, 현재 도구 또는 `N tools`, 경과)와 백그라운드 작업(Background 표시, 상태, 프롬프트)이다.
  - 간선은 루트에서 자식으로 간다. 자식은 `delegate_task` 호출(delegationId)별로 호출 순서대로 행에 묶는다.
  - Esc, 바깥 클릭, 버튼으로 닫는다. 자식 노드를 누르면 요약과 outputTail이 펼쳐진다(`SubagentBlock.tsx` 조각 재사용). 백그라운드 노드를 누르면 그 세션에 포커스한다.
- 배치: 행 단위의 단순한 층 배치에 SVG 직교 간선을 쓴다. 그래프 라이브러리는 추가하지 않는다(오프라인 앱, 의존성 최소).
- 노드 스타일은 이미지를 따르되 unslop 규칙을 지킨다. 1px 헤어라인, 중립 회색 + 강조색 1개, 글로우와 그라데이션 없음. 점선 테두리는 시작 전/끝난 노드에만 쓴다.
- 갱신은 기존 상태에서 실시간으로 한다. 1초 틱은 실행 중인 것이 있을 때만 돈다(`SubagentBlock`과 같은 방식).
- 선택: 패널 행의 `N agents`를 누르면 같은 보기가 열리게 한다.

## 버전

- `docs/VERSIONING.md`에 따라 새 기능이므로 MINOR다. 0.8.0으로 낸다.
- 0.8.0에는 입력창 기록 위치 표시(PR #19, 이미 main에 있고 아직 릴리스 전)도 들어간다. 0.7.1은 태그를 만든 적이 없다.
- 사용자가 처음에 "0.7.1"이라고 했으므로, 태그를 만들기 전에 0.8.0으로 가도 되는지 확인한다.
- 절차는 VERSIONING.md의 "올리는 파일과 절차"를 따른다. 노트는 `docs/releases/v0.8.0.md`에 쓰고, "새로 더한 것"에 그래프 보기, "다듬은 것"에 기록 위치 표시를 넣는다.

## 작업 규칙

`docs/HANDOFF.md` 5절을 따른다.

- `~/.claude/`는 절대 건드리지 않는다. 훅은 에이전트 작업을 막으면 안 된다. 실행 중 네트워크 접속은 없다.
- 디자인은 unslop 규칙을 따른다. 화면 라벨은 짧은 영어, 설명 문장은 한글이다. 화면에서 "pane"이라고 쓰지 않는다.
- 감독 모델이 계획과 검토를 맡고, 코드는 Sonnet 서브에이전트가 쓴다. UI를 먼저 검증하고, 사용자에게는 한국어로 설명한다.
- 채팅 보기는 Tauri 앱에서만 그려진다(`desk/`에서 `npm run tauri dev`). 웹 개발 서버(`.claude/launch.json`의 `desk-web`)는 모의 터미널 칸만 보여준다. 웹에서 미리 보려면 `desk/src/mock/sessions.ts`에 서브에이전트와 백그라운드 샘플을 추가해야 할 수 있다.

## 완료 기준

- 버튼이 맞게 나타나고 사라진다. 그래프의 개수가 맞고 실시간으로 갱신된다. 채팅 칸에서 동작하고, TUI 칸은 최소한 백그라운드 작업을 보여준다.
- 새 순수 배치·묶음 함수에는 vitest를 둔다. `desk/`에서 `npx tsc --noEmit`과 `npx vitest run`이 통과한다.
- 실제 Tauri 앱에서 `delegate_task` 실행과 `/background` 실행으로 확인하고, 스크린샷을 사용자에게 보여준다.
- PR을 만들고 CI를 본 뒤 머지하고, VERSIONING.md대로 0.8.0을 릴리스한다.
