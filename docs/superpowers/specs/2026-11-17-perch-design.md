# Perch — 설계

날짜: 2026-11-17 · 저장소: `Isaac-Lee/Perch`

## 1. 무엇을, 왜

여러 코딩 에이전트(Hermes, OpenCode) 세션을 한 앱에서 분할 터미널로 띄워 쓰고, 옆 패널에서 모든 세션 상태를 한눈에 보는 데스크톱 앱이다.

배경은 이렇다.
- 사용자는 Hermes Agent를 CLI로 여러 개 띄워 작업한다. 사용 환경은 회사 오프라인 Windows 10 PC, 그리고 맥북이다.
- 어디서 무엇이 돌고 있는지, 어떤 세션이 내 답을 기다리는지, 각각 몇 분째인지, 서브에이전트가 몇 개이고 무엇을 하는지를 매번 탭을 돌며 확인해야 했다. Tabby와 CLI 대시보드로 시도했다. 하지만 한 화면에 그래픽 패널과 분할 터미널을 함께 두고 싶어서 전용 앱을 만든다.
- Hermes 자체 GUI는 무겁고 오류가 많아 CLI로 옮기는 중이다. 이 앱은 가벼워야 한다.

## 2. 목표 / 비목표 / 반목표

**목표 (1차)**
- 분할 터미널 칸에서 `hermes`, `opencode`, 일반 셸을 실행한다. 칸 개수 제한은 없고 자동 격자로 배치한다.
- 앱 창을 여러 개 띄울 수 있다. 어느 창의 패널이든 **모든 창, 모든 세션**을 보여준다. 앱 밖에서 연 세션도 포함한다.
- 패널은 세션을 **작업 디렉토리별**로 묶는다. git 저장소면 저장소 이름으로, 아니면 "공통 작업 공간"으로 묶는다.
- 세션 상태를 표시한다: 작업중, 생각중, 도구 실행, 승인대기, 질문대기, 답변대기, 종료. 상태가 이어진 시간도 함께 보여준다.
- 서브에이전트(개수, 역할, 목표, 경과시간)와 todo 체크리스트를 표시한다.
- 칸 상단에 생각 중 표시를, 칸 하단에 진행 줄("지금 하는 일 · N단계 · 경과시간")을 둔다.
- 패널에서 세션을 클릭한다. 열려 있으면 그 칸으로 이동하고, 다른 창이면 그 창을 앞으로 가져온다. 닫혀 있으면 현재 창에 칸을 추가해 resume으로 연다.
- Hermes 승인 요청은 패널의 [허용] [거절] 버튼으로 바로 처리한다.
- 오프라인 Windows 10에 설치할 수 있는 단일 설치 파일을 만든다.

**비목표 (1차에서 안 함)**
- oh-my-pi / pi 어댑터 (2차)
- 칸 경계 드래그로 크기 조절
- OpenCode 승인을 패널에서 처리하는 기능. 칸으로 이동만 한다.
- 화면에 열려 있지 않은 세션의 승인을 패널에서 처리하는 기능. 칸을 먼저 연다.
- macOS 설치 파일 빌드. 소스 빌드가 되는 구조만 유지한다.
- 원격(SSH) 세션

**반목표 (기술적으로 돌아가도 실패로 본다)**
- Claude Code 설정(`~/.claude/settings.json`)이나 훅을 건드린다.
- 에이전트 작업을 막는다. 훅이 실패하거나 앱이 꺼져 있어도 에이전트는 평소대로 돌아야 한다.
- 실행 중 네트워크에 접속한다. 자동 업데이트, 텔레메트리, CDN 폰트를 쓰지 않는다.
- AI 느낌이 나는 장식을 넣는다 (아래 6절).
- 무겁다. 칸 8개를 띄워도 Tabby보다 가벼워야 한다.

## 3. 제약

- 대상 OS는 Windows 10 (1809 이상, ConPTY 필요)이고 오프라인이다. 맥은 같은 소스로 빌드할 수 있어야 한다.
- WebView2가 없을 수 있다. 설치 파일에 WebView2 오프라인 설치본을 포함한다 (Tauri `webviewInstallMode: offlineInstaller`).
- 라이선스는 상업적 사내 사용에 문제가 없어야 한다 (MIT, Apache-2.0, ISC, BSD, CC-BY + 출처 표기).
- Hermes 0.23 이상이다. 에이전트 루프는 공용 gateway 프로세스에서 돈다. 셸 훅도 gateway에서 실행되며, 훅 환경변수는 gateway 것이다. 칸의 환경변수는 훅에 전달되지 않는다.
- 빌드 PC(이 PC)에는 Node 26, VS Build Tools 2026, Windows SDK가 있다. Rust는 없으므로 rustup으로 설치한다.
- 구현은 Sonnet 서브에이전트가 맡고 감독자가 지시와 검토를 한다. 그래서 작업 단위는 파일, 동작, 완료 기준이 명확해야 한다.

## 4. 접근 방식

| 안 | 내용 | 장점 | 단점 | 결정 |
|---|---|---|---|---|
| **A. Tauri 2** | WebView2/WKWebView 화면 + Rust 백엔드 | 설치 파일 작음, 메모리 적음, 맥 빌드 가벼움 | Rust 설치 필요. Win10은 WebView2를 포함해야 해서 설치 파일 약 130MB | **선택** |
| B. Electron | Chromium 내장 | 개발 쉬움, 사례 많음 | 무거움 (사용자가 Tabby를 무겁다고 함) | 제외 |
| C. Python + Qt | 데스크톱 위젯 | Python만 있으면 됨 | 쓸 만한 터미널 위젯이 없고 React 기반 libraries.dev를 쓸 수 없음 | 제외 |
| D. WezTerm Lua | 설정으로 꾸미기 | 앱 개발 불필요 | 그래픽 패널 불가 | 제외 |

사용자가 A를 골랐다. 오프라인 PC가 Windows 10인 것을 확인한 뒤에도 A를 유지했다.

## 5. 구조

```
Perch/
  desk/                     Tauri 앱
    src/                    React + TypeScript (Vite)
    src-tauri/              Rust: PTY, 창, 상태 수집, 설치 도우미
    src-tauri/hook/         perch-hook.exe (별도 작은 바이너리)
  adapters/opencode/        OpenCode 플러그인 (perch.ts)
  docs/
```

### 5.1 공통 상태 형식 (에이전트 ↔ 앱의 유일한 계약)

- 위치: `~/.perch/sessions/<agent>-<sessionId>.json`. 환경변수 `PERCH_HOME`으로 바꿀 수 있다.
- 쓰는 쪽은 어댑터다. 원자적으로 쓴다 (tmp 파일에 쓴 뒤 rename, 파일 잠금).
- 읽는 쪽은 앱이다.

필드:

```
agent        "hermes" | "opencode"
sessionId    에이전트의 세션 ID
cwd          세션 작업 폴더 (모르면 빈 값 → 앱이 보완)
state        running | thinking | tool | approval | question | idle | closed
since        state가 시작된 시각 (epoch 초)
turnStart    이번 요청(턴) 시작 시각
steps        이번 턴의 도구 호출 수
tool         실행 중인 도구 이름, toolDetail: 인자 요약 (예: "npm test", 최대 80자)
prompt       마지막 사용자 요청 앞 80자
pending      { kind: approval|question, id, text }   승인/질문 대기일 때만
subagents    { <childId>: { role, goal, start, tool } }
todos        [ { text, status: pending|in_progress|done } ]
seen         마지막 이벤트 시각
```

### 5.2 Hermes 어댑터 = 셸 훅

- `perch-hook.exe hermes`로 실행된다. stdin JSON을 받아 상태 파일을 갱신한다. Rust로 작성하며 기존 `dash.py hook` 로직을 이식한다.
- 이벤트별 매핑:
  - `on_session_open`: 세션 생성
  - `pre_llm_call`: turnStart, steps=0, prompt, state=thinking
  - `pre_api_request`: state=thinking
  - `pre_tool_call`: state=tool, tool, toolDetail, steps+1
  - `post_tool_call`: state=thinking. 도구가 `todo`면 todos를 갱신한다.
  - `on_human_input_request`: approval 또는 question, pending 설정
  - `on_human_input_resolved`: pending 제거
  - `on_session_end`, `agent_loop_stopped`: idle
  - `on_session_finalize`: closed
  - `on_session_delete`: 파일 삭제
  - `subagent_start`, `subagent_stop`: subagents 갱신
  - 서브에이전트 세션 자신의 이벤트는 부모 항목의 tool만 갱신한다 (`dash.py` 방식)
- **안전 규칙 (반드시 지킨다)**
  - 훅 명령은 `.exe` 경로만 등록한다. `python x.py` 형태는 금지한다. 파일이 없으면 python이 exit 2를 내고, Hermes는 `pre_tool_call`의 exit 2를 "차단"으로 처리하기 때문이다. 이것이 실제로 Claude Code에서 일어난 사고다.
  - `fail_closed`는 쓰지 않는다 (기본값 false).
  - 어떤 입력이나 오류에도 exit 0으로 끝나고 stdout에는 아무것도 쓰지 않는다.
  - Hermes 소스(`agent/shell_hooks.py`)로 확인한 동작은 다음과 같다. 실행 실패와 시간 초과는 통과(fail open)이고, exit 2만 차단이다.
- 연결 방법:
  - 앱의 "Hermes 연결" 버튼이 HERMES_HOME의 `config.yaml`에 표시된 블록(`# >>> perch` … `# <<< perch`)을 추가한다.
  - 같은 버튼이 `shell-hooks-allowlist.json`에 승인 항목도 넣는다.
  - 기존 `hooks:`가 있으면 자동으로 합치지 않고, 넣을 내용을 보여준다.
  - 연결 해제는 블록과 승인 항목을 제거한다.
  - 로직은 `dash.py install/uninstall`을 이식한다.
- 세션 cwd: 훅의 `cwd`는 gateway 폴더라 쓰지 않는다. 대신 아래 둘을 쓴다.
  - 앱 칸에서 연 세션: 칸의 폴더
  - 그 외: HERMES_HOME `state.db`의 `sessions.cwd` (읽기 전용 SQLite)

### 5.3 OpenCode 어댑터 = 플러그인

- `adapters/opencode/perch.ts`. "OpenCode 연결" 버튼이 `~/.config/opencode/plugins/`에 복사한다.
- 같은 상태 형식을 쓴다. 사용할 hook:
  - `tool.execute.before/after`
  - 권한 hook
  - session idle과 todo 이벤트: 정확한 이름은 미확인이다. 아래 9절 참고.
- 플러그인은 칸과 같은 프로세스 쪽 환경을 볼 수 있으므로 `PERCH_PANE`을 상태 파일에 기록한다. 그래서 칸과 세션 연결이 정확하다.
- 플러그인은 어떤 오류도 OpenCode로 던지지 않는다 (try/catch로 무시).

### 5.4 칸 ↔ 세션 연결

- 앱이 칸을 만들 때 `PERCH_PANE=<paneId>` 환경변수와 폴더를 지정해 PTY를 띄운다.
- Hermes: gateway가 칸 환경을 모르므로 앱이 PTY 출력에서 Hermes가 출력하는 세션 ID 줄(`Session: <id>`)을 찾아 연결한다.
  - 정확한 출력 형식은 구현 첫 단계에서 확인한다.
  - 찾지 못하면 "칸 생성 직후 처음 열린, 다른 칸이 갖지 않은 세션" 규칙으로 대체한다.
  - `/new`로 세션이 바뀌면 `old_session_id → new_session_id` 기록을 따라간다.
- OpenCode: 상태 파일의 `pane` 필드로 연결한다.
- resume 명령:
  - Hermes: `hermes --cli chat --resume <id>` (Hermes 문서에서 확인)
  - OpenCode: 정확한 플래그는 구현 시 확인한다.

### 5.5 앱 내부

- **단일 프로세스, 여러 창.** 두 번째 실행은 기존 프로세스에 새 창을 연다 (Tauri single-instance 플러그인). 그래서 모든 창이 같은 칸 목록과 상태를 공유한다.
- **Rust 백엔드가 맡는 일**
  - PTY 관리: `portable-pty`
  - 상태 폴더 읽기: 500ms 폴링. 파일 감시 라이브러리는 나중에 필요하면 넣는다.
  - `state.db` cwd 조회
  - git 루트 계산: 상위 폴더로 올라가며 `.git`을 찾는다
  - 창 목록과 칸 소속 관리
  - 프론트에는 이벤트로 상태 전체 스냅샷을 보낸다.
- **프론트**
  - React 18 + TypeScript + Vite
  - 터미널: `@xterm/xterm` + `@xterm/addon-fit`
  - 아이콘: `lucide-react` (ISC)
- **분할 격자**
  - 칸 수 n에 대해 열 = ⌈√n⌉, 행 = ⌈n/열⌉ (1→1×1, 2→2×1, 3~4→2×2, 5~6→3×2, 7~8→3×3 …)
  - 마지막 행의 빈 칸은 앞 칸이 넓혀 채운다.
  - 새 칸은 맨 끝에 추가한다.
  - 사용자 결정은 "6~8분할이면 위아래로도 나뉜다"였다. 정확한 배치 공식은 빌더 재량이다. 이 공식은 감독자가 정한 기본값이다.
- **바로 승인 (Hermes만)**: 버튼을 누르면 해당 칸 PTY에 Hermes 명령을 입력한다.
  - 명령: `/approve <id> once` 또는 거절 명령, 뒤에 Enter
  - 명령 문법과 ID 출처(`on_human_input_request.request_id`와 화면 ID가 같은지)는 구현 첫 단계에서 Hermes 소스로 확인한다.
  - 칸이 없으면 칸부터 연다.
- **새 칸 만들기**: 창 상단의 [+] 버튼을 누르면 에이전트(Hermes/OpenCode/셸)와 폴더를 고르는 작은 메뉴가 나온다. 폴더 기본값은 최근 폴더다.

## 6. 화면

```
┌ 세션 ───────────────────┐┌ hermes · todo-api ─────── ✳ 생각 중 ┐┌ ... ┐
│ todo-api  (git)          ││                                      ││     │
│  ⚠ 승인대기 2m [허용][거절] ││ (터미널)                             ││     │
│  ● 작업중 5m  2 agents    ││                                      ││     │
│    └ leaf 로그 분석 1m    ││                                      ││     │
│    ☑ 빌드 수정 ◐ 테스트 ☐ 배포││                                      ││     │
│ 공통 작업 공간            ││                                      ││     │
│  ◆ 답변대기 1m            │└ ··· terminal: npm test · 3단계 · 4분 8초 ┘└─────┘
└─────────────────────────┘
```

- **패널**
  - 디렉토리 묶음 순서: 내 차례(승인, 질문, 답변 대기)가 있는 묶음이 위로 온다. 묶음 안에서도 같은 순서로 정렬한다.
  - 상태 점은 작업중일 때만 천천히 깜빡인다.
  - 승인대기에는 버튼이 붙는다. 질문대기는 클릭하면 칸으로 이동한다.
  - 접기와 펼치기가 된다. 너비는 240~280.
- **칸 상단 줄**
  - 에이전트 · 폴더 이름
  - 생각 중일 때만 애니메이션 + "생각 중 12s"
  - 승인이나 질문 대기 중에는 줄 전체가 경고색으로 바뀌고 문구를 보여준다.
- **칸 하단 진행 줄**: 작업중일 때 "지금 하는 일 · N단계 · 경과시간"을 보여준다. 로딩 표시는 libraries.dev의 `thinking-orbs`를 쓴다 (사용자 지정).
- **libraries.dev 사용처** (MIT, React)
  - `thinking-orbs`: 하단 진행 줄
  - 칸 상단 생각 중 애니메이션도 같은 패키지의 다른 변형을 우선 검토한다.
  - 다른 효과(border-beam 등)는 쓰지 않는다. unslop 규칙과 충돌하기 때문이다.
  - 모델 파일(`LICENSE-MODEL`)이 필요한 기능은 쓰지 않는다.
- **디자인 규칙**: unslop(CC-BY-4.0, 출처는 README에 표기)을 적용한다.
  - 4px 격자
  - 중립 배경과 강조색 1개
  - 1px 헤어라인 테두리
  - 글꼴 굵기 400/500
  - 그라데이션, 글로우, 이모지 아이콘 금지
  - 아이콘은 lucide 16px, 선 굵기 1.5
  - 숫자는 tabular-nums
  - 문구는 짧게, 느낌표 없이
  - 애니메이션 예외는 사용자가 정한 세 곳뿐이다: 작업중 점 깜빡임, 칸 상단 생각 중, 하단 진행 줄.
- **글꼴**: 네트워크를 쓸 수 없으므로 시스템 글꼴을 쓴다.
  - UI: Segoe UI / 맑은 고딕 / Apple SD Gothic Neo
  - 터미널: Cascadia Mono → Consolas → Menlo, D2Coding이 있으면 우선
- **다크 테마 기본.** 라이트 테마는 1차에서 하지 않는다.

## 7. 작업 순서 (UI 먼저 검증)

1. **UI 시제품**
   - 가짜 상태 데이터와 가짜 터미널 출력으로 패널, 격자, 칸 상단·하단 줄, 승인 버튼, 디렉토리 묶음을 만든다.
   - 브라우저(Vite)와 Tauri 창에서 사용자 검토를 받는다.
   - 여기서 화면이 확정되기 전에는 다음 단계로 가지 않는다.
2. 실제 PTY 칸 (hermes, opencode, 셸 실행). 여러 창, 칸 이동, resume.
3. Hermes 어댑터 (훅 바이너리, 연결 버튼). 실제 Hermes로 상태가 바뀌는지 확인한다.
4. OpenCode 어댑터.
5. 오프라인 설치 파일 (NSIS + WebView2 포함). 깨끗한 Windows 10 환경에서 설치를 검증한다.

각 단계는 Sonnet 서브에이전트에게 맡긴다. 감독자가 결과를 검토하고 실행해서 확인한 뒤 다음 단계로 간다.

## 8. 기존 코드 처리

- `dash.py`는 3단계에서 Rust 훅이 대체한다.
  - 그때 저장소에서 제거한다 (감독자 결정).
  - 상태 폴더도 `~/.agent-dash` → `~/.perch`로 바뀐다.
- 그 전까지는 참고 구현으로 남긴다. 단, 형식은 새 공통 형식 기준이다.

## 9. 빌더 검토 반영 (결정 사항)

빌더 검토에서 나온 질문에 대한 답이다. **(감독자 결정)** 표시는 사용자가 아니라 감독자가 정한 것이다.

1. **`pre_tool_call`, `pre_api_request` 등록**
   - 두 이벤트 모두 등록한다. 사용자 지시는 "안전할 때만"이었고, 감독자가 Hermes 소스로 안전 조건을 확인했다.
   - 3단계 완료 기준에 다음 테스트를 넣는다: 훅 exe를 지운 상태에서 도구가 정상 실행되는지, 훅이 잘못된 JSON을 받았을 때 exit 0으로 끝나는지.
   - 훅 timeout은 5초로 한다.
   - Rust exe는 시작 비용이 수 ms 수준이라 도구 호출마다 실행해도 된다. `dash.py`의 `pre_tool_call` 제외는 python 경로 문제 때문이었고, exe로 해소된다.
2. **Hermes 대상**
   - Windows 네이티브 설치다 (`D:\hermes-cli`, HERMES_HOME=`D:\hermes-cli\home`). 이 빌드 PC의 Hermes는 다른 세션에서 설치를 준비하고 있다. 3단계 전까지 준비되지 않으면 그 단계는 대기한다.
   - 칸 연결은 정확해야 한다. 그래서 Hermes 칸 생성을 직렬화한다 **(감독자 결정)**: 다음 Hermes 칸은 이전 칸이 세션에 연결되거나 5초가 지난 뒤에 띄운다. 이렇게 하면 추측 규칙의 경쟁 조건이 없어진다.
   - resume으로 여는 칸은 ID를 알고 있으므로 항상 정확하다.
3. **바로 승인의 대체 경로 (감독자 결정)**
   - 명령 문법이나 ID 일치가 확인되지 않으면 버튼을 [칸으로 이동]으로 바꾼다.
   - 입력 보호: 해당 세션의 `state`가 approval이고 `pending.id`가 버튼의 id와 같을 때만 PTY에 입력한다.
   - 입력 직전에 칸의 입력줄을 비우는 키(Ctrl+U)를 먼저 보낸다. 사용자가 치던 글자가 섞이는 것을 막기 위해서다.
4. **창과 칸의 소유 (감독자 결정)**
   - PTY는 백엔드가 가지고, 창은 보기만 한다.
   - 창을 닫으면 그 창의 칸 PTY를 종료한다. Hermes CLI는 닫혀도 세션이 gateway에서 계속 진행되므로 작업이 끊기지 않는다 (Hermes 문서 "closing the terminal detach only"). 패널에서 다시 열면 resume된다.
   - 창 간 칸 이동과 스크롤백 재생은 하지 않는다.
   - 앱을 재시작하면 빈 창으로 시작한다. 레이아웃 복원은 1차 비목표다. 패널에 세션이 남아 있으므로 클릭으로 다시 열 수 있다.
5. **세션 정리 (감독자 결정)**
   - 패널 기본 표시 대상: 열린 칸에 연결된 세션, 또는 마지막 이벤트가 24시간 이내인 세션.
   - closed와 24시간이 지난 세션은 접힌 "최근" 묶음에 둔다 (7일 이내). 7일이 넘은 상태 파일은 앱이 시작할 때 지운다.
   - 작업중 계열(thinking, tool, running) 상태에서 10분 동안 이벤트가 없으면 "응답 없음"으로 표시한다.
6. **묶음 키 (감독자 결정)**
   - 키는 git 저장소 루트의 전체 경로다. 표시 이름은 폴더 이름이다.
   - 이름이 겹치면 상위 폴더를 덧붙여 구분한다.
   - 같은 저장소의 하위 폴더는 같은 묶음이다. worktree는 각자 루트 경로를 쓰므로 별도 묶음이다.
   - cwd를 모르면 "공통 작업 공간"에 넣는다.
7. **OpenCode는 부분 지원을 허용한다 (감독자 결정)**
   - 최소 기준: 작업중/대기, 도구, 권한 대기 상태 표시와 칸 이동.
   - idle/todo 이벤트가 없으면 그 표시는 빼고 출시한다.
   - `PERCH_PANE` 환경변수가 플러그인에 보이지 않으면, Hermes처럼 칸 생성 직렬화 + 출력 스캔으로 대체한다.
   - 이 PC에 OpenCode를 설치해 검증한다.
8. **설치**
   - 빌드는 이 PC에서만 한다. 오프라인 PC는 실행만 한다.
   - NSIS는 사용자별 설치다 (관리자 권한 불필요). 경로는 `%LOCALAPPDATA%\Programs\Perch\`다.
   - 훅 exe는 같은 폴더에 둔다. "Hermes 연결" 버튼은 앱 실행 파일 옆의 exe 경로를 쓴다. 앱 업데이트 시에도 경로가 같아야 하므로 버전 폴더를 쓰지 않는다.
   - 코드 서명은 없다. 그래서 SmartScreen 경고가 나오는 것은 알려진 한계로 둔다.
   - 깨끗한 Windows 10 검증 환경은 사용자 확인 사항이다 (10절).
9. **`thinking-orbs`**
   - npm 패키지(MIT, React)를 빌드 시 번들에 포함하므로 오프라인 실행에 문제가 없다.
   - 쓸 수 없으면 직접 만든 작은 CSS 애니메이션으로 대체하고 사용자에게 알린다.
10. **성능 기준 (감독자 결정)**
    - 2단계 완료 기준: 이 PC에서 칸 8개(셸)를 띄운 상태의 유휴 메모리가 같은 조건의 Tabby보다 적을 것.
    - 상태 폴링 때문에 앱 CPU가 유휴 시 1%를 넘지 않을 것.

## 10. 사용자 확인이 필요한 것

- 5단계 설치 검증을 어디서 할지: Windows 10 가상머신이 있는지, 아니면 실제 오프라인 PC에서 사용자가 직접 확인할지.

## 11. 빌더 재량과 확인 과제

- 첫 단계에서 실제 소스나 실행으로 확인한다:
  - Hermes 세션 ID 출력 형식
  - `/approve` 명령 문법과 ID 출처
  - OpenCode 플러그인 이벤트 이름 (idle, todo, permission)과 resume 플래그
- 확인 결과에 따라 5.3, 5.4의 대체 경로를 택한다.
- 색상 값, 간격, 컴포넌트 구조, 상태 관리 방식은 6절 규칙 안에서 빌더가 정한다.
