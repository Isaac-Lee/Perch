# 인수인계 — Perch

다른 PC(주로 macOS)에서 이어서 작업하기 위한 문서다. 이 문서만 읽고 시작할 수 있게 썼다.

## 1. 한 줄 요약

Perch는 여러 코딩 에이전트(Hermes, OpenCode)를 분할 터미널로 띄우고, 옆 패널에서 모든 세션 상태를 지켜보는 데스크톱 앱이다. **1~3단계(UI, Tauri + 실제 터미널, Hermes 연결)는 끝났다. 4단계(OpenCode)는 하지 않기로 했다. 5단계(오프라인 설치 검증)와 맥 앱 실행 확인은 사용자가 직접 한다.** 모든 작업은 `main`에 병합돼 있다. 최신 릴리스는 6절을 본다.

## 2. 지금 있는 것

| 위치 | 내용 | 상태 |
|---|---|---|
| `desk/src/` | 화면 (React 19 + TypeScript). 브라우저에서는 가짜 데이터, Tauri 창에서는 실제 백엔드 | `npm test`로 확인 |
| `desk/src-tauri/src/` | Rust 백엔드: `pty.rs`(터미널), `desk.rs`(칸·창), `sessions.rs`(상태 수집, state.db 보강), `hermes.rs`(실행 파일 찾기, 연결) | `cargo test --workspace`로 확인 |
| `desk/src-tauri/src/gateway.rs` | Hermes gateway 중계. `hermes gateway attach`가 준 ws:// 주소에 loopback TcpStream으로 직접 WebSocket을 말하고 JSON 줄을 채팅 칸과 주고받는다 (gateway가 Origin 헤더를 거부해서 웹뷰가 직접 못 붙는다) | 테스트 포함 |
| `desk/src/components/Chat*.tsx` | 채팅 보기. `ChatView`(전체), `ChatMessage`(마크다운 답변·도구 줄), `ChatPrompt`(승인·질문 버튼), `ChatComposer`(입력 상자: `+` 이미지, 모델 칩과 메뉴, 엔터 아이콘) | `chatSession`, `composer` 테스트 |
| `desk/src/lib/chatSession.ts` | 채팅 상태 리듀서와 훅. gateway 이벤트를 항목으로 바꾸고 resume, 모델 변경, 한 번의 자동 재연결을 맡는다 | 녹화한 턴(`__fixtures__/turn.jsonl`)으로 재생 테스트 |
| `desk/src/lib/gateway.ts`, `gatewayTypes.ts` | JSON-RPC 2.0 클라이언트와 손으로 옮겨 적은 wire 타입(hermes-gateway-v1) | 테스트 통과 |
| `desk/src/lib/markdown.tsx` | 채팅용 마크다운 렌더러 | 테스트 통과 |
| `desk/src-tauri/hook/` | `perch-hook`: Hermes 셸 훅이 부르는 작은 바이너리. 상태 파일을 쓴다 | `hook/tests/hook.rs` |
| `desk/scripts/build-hook.mjs` | 훅을 빌드해 Tauri 사이드카 위치로 복사 (`npm run hook`) | `tauri dev`/`build`가 자동 실행 |
| `.github/workflows/build.yml` | Windows 설치 파일과 macOS(Apple Silicon) dmg를 만든다. PR과 수동 실행은 결과물만 남기고, `v*` 태그는 초안 릴리스에 붙인다 | PR #1에서 두 OS 모두 통과 |
| `docs/ADAPTERS.md` | 다른 에이전트를 붙일 때의 계약과 손댈 곳 | OpenCode는 하지 않음 |
| `docs/superpowers/specs/2026-11-17-perch-design.md` | 설계 문서. 성능 기준은 9절 10번 | 메모리 기준 500MB로 변경됨 |
| `docs/superpowers/plans/` | 단계별 계획. 2단계(`phase2-tauri-pty`), 3단계(`phase3-hermes`: 확인된 Hermes 사실 포함) | 2·3단계 완료 |

결과물 (Windows, 이 PC에서 빌드):
- `desk/src-tauri/target/release/perch.exe` — 설치 없이 실행. 같은 폴더의 `perch-hook.exe`가 필요하다.
- `desk/src-tauri/target/release/bundle/nsis/Perch_<버전>_x64-setup.exe` — 사용자별 설치 파일, WebView2 오프라인 설치본 포함 (216MB). 설치 시험은 아직 안 했다.

## 3. 새 PC에서 시작하기

```bash
git clone https://github.com/Isaac-Lee/Perch.git
cd Perch/desk
npm install
npm test          # 모두 통과해야 한다
npm run dev       # 브라우저 모드 (가짜 데이터) http://localhost:5173
npm run tauri dev # 앱 창 (실제 터미널). Rust 필요
npm run tauri build   # 릴리스 exe와 설치 파일
```

- Node 22.12 이상이 필요하다 (CI는 24).
- 화면을 주소로 바로 열 수 있다.
  - `#usage`: 토큰 사용량 화면
  - `#usage&chart=1y&bucket=week`: 1년 주별 차트 (`chart`는 `14d`/`30d`/`1y`, `bucket`은 `day`/`week`)
- 설정은 브라우저 localStorage의 `perch.*` 키에 저장된다. 초기화하려면 그 키를 지운다.

앱 창과 빌드에 필요한 것 (Windows 빌드 PC에는 Rust 1.100, VS 2022 Build Tools를 설치해 두었다):

| 도구 | macOS | Windows |
|---|---|---|
| Rust | `rustup` | `rustup` |
| 네이티브 빌드 도구 | Xcode Command Line Tools | VS Build Tools (C++) + Windows SDK |
| 웹뷰 | 기본 포함 (WKWebView) | WebView2 (Win10은 설치 파일에 포함해야 함) |

## 4. 설계 문서 이후에 바뀐 결정

설계 문서를 쓴 뒤 사용자 검토에서 정해진 것이다. 설계 문서와 다르면 **이 절이 우선한다.**

**이름과 모양**
- 앱 이름은 Agent Desk에서 **Perch**로 바뀌었다.
  - 저장 폴더: `~/.perch`
  - 환경변수: `PERCH_HOME`, `PERCH_PANE`
  - 훅 바이너리: `perch-hook.exe`
  - localStorage 키: `perch.*`
- 아이콘은 `desk/public/icon.svg`다 (횃대 위의 새). 앱 아이콘(`.ico`/`.icns`/`.png`)은 `desk/src-tauri/icons/`에 있다.
- 화면 언어: 짧은 라벨, 상태, 버튼은 영어로 쓴다. 설명 문장(안내, 툴팁, 설정 설명)은 한글로 쓴다. 사용자 내용은 그대로 둔다. `aria-label`은 영어로 쓴다. 채팅 보기의 버튼(되감기, 편집, 포크 등)은 아직 한글이고, 영어로 바꿀지는 정해지지 않았다.
- 화면에서는 "pane"이라는 말을 쓰지 않는다. 상단 바는 `N open`, 그 밖에는 "session"이라고 쓴다. 코드 안의 이름(Pane 컴포넌트 등)은 그대로 둔다.
- 글꼴은 모두 OFL이고 `desk/public/fonts/`에 들어 있다.
  - UI: IBM Plex Sans(영어) + IBM Plex Sans KR(한글)
  - 터미널 기본: D2Coding (사용자가 유지하기로 결정)
  - 터미널 선택지: Monoplex KR
- 패널 기본 폭은 320px이다 (200~480 범위에서 조절).

**칸 안에서 앱이 그리는 것 (Hermes 자체 화면과 중복을 줄임)**
- 유지: 칸 하단 진행 줄, 칸 상단 생각 중 아이콘, 포커스 테두리, Stop 버튼, 헤더의 상태 점
- 제거: 승인·질문 대기 시 헤더 경고색과 문구, 입력 줄 배경 띠, "입력 중" 라벨
- 만들지 않음: 모델 표시 (Hermes 상태줄에 이미 있음), 별도 입력창 (에이전트의 자동완성과 선택 메뉴를 잃기 때문). 이것은 터미널(TUI) 칸에 해당한다. v0.3.0의 채팅 보기는 입력 상자와 모델 칩을 직접 그린다.
- 승인·질문의 자세한 내용, 입력창, 서브에이전트 독은 Hermes가 터미널 안에 직접 그린다. 앱은 패널에서 요약과 [Allow]/[Deny]만 제공한다.

**추가된 기능**
- 토큰 사용량: 패널 세션 행의 토큰 수, 상단 "Today … tok", 사용량 화면(기간 합계, 14d/30d/1y 차트, 1y는 일별/주별, 프로젝트·모델·에이전트·세션별 표).
  - 방식은 codeburn(MIT)을 참고했고 코드는 새로 썼다.
  - 가격표는 넣지 않는다. 비용은 에이전트가 기록한 값이 있을 때만 표시한다.
- Stop 버튼, 패널 폭 조절, 묶음 접기, 새 세션 기본값(에이전트 + 폴더), 터미널 글꼴/크기 설정, git 브랜치 표시.

**2026-11-17~18에 추가된 화면 결정 (사용자 검토)**
- 세션 상태 표시: 턴을 끝낸 세션은 **Done**(초록 점, 깜빡임 없음), 열었지만 아직 요청하지 않은 세션은 문구 없는 중립 점, 상태 정보가 없는 칸(셸 등)도 중립 점이다. "waiting on you"는 승인과 질문만 센다. 상태 파일의 `state` 값은 그대로 `idle`이고, 화면이 `prompt` 유무로 Done과 요청 전을 가른다 (`groups.ts` `displayState`).
- 시간 표시: 요청을 보낸 순간부터 흐르고, Done이 되면 걸린 시간에서 멈춘다. 훅이 턴 종료 때 `lastTurn`(초)을 상태 파일에 남긴다. 요청 전 세션, 셸, 닫힌 세션은 시간을 보여주지 않는다 (`groups.ts` `shownSeconds`).
- 새 세션: 패널과 상단 바에 `+ New session | Hermes · 폴더 ▾`가 있다. 오른쪽을 누르면 폴더·에이전트 선택 메뉴가 열리고, 여기서 고른 값이 기본값이다. `Choose folder…`는 앱에서 OS 폴더 선택창을 연다. 패널의 묶음 제목 줄에도 그 폴더에서 바로 여는 `+`가 있다.
- 검색: 세션 제목, 폴더, 브랜치만 본다. 띄어 쓴 단어는 모두 들어 있어야 한다. 제목은 에이전트가 붙인 것(Hermes `state.db`의 `sessions.title`)이고, 없으면 마지막 요청 문구를 대신 쓴다. 대화 기록 검색은 하지 않는다.
- 단축키: `src/lib/shortcuts.ts`의 표 하나가 동작과 도움말을 모두 구동한다. 터미널 입력과 겹치지 않게 `Ctrl+Shift` 조합과 `Ctrl+Tab`, `Ctrl+1~9`만 쓴다. `Ctrl+N` 같은 키는 셸과 Hermes가 쓰므로 가로채지 않는다.
- 토큰 단위는 앞에 붙는 `Ŧ`다 (`Ŧ 637.4k`). `₸`는 실제 통화 기호라 쓰지 않는다.
- 설정 메뉴는 "라벨 왼쪽, 컨트롤 오른쪽" 2열 행이다. 직접 입력칸은 `Custom…`을 골랐을 때만 나온다.
- 메모리 기준은 500MB(작업 집합 합계)로 올렸다. 줄이는 일은 미뤘다.

**2026-11-20에 추가된 화면 결정**
- 읽음/안 읽음: Done·Reply needed 세션은 그 상태가 된 뒤(`since`) 사용자가 그 세션 칸에 포커스를 두거나 패널 행을 누르기 전까지 안 읽음이다. 행에 강조색 점과 굵기 500 제목, 같은 상태 안에서 위로 정렬, 접힌 묶음 제목에 수. 읽은 시각은 `perch.readAt`(세션별 초, 300개 상한). 판정은 `groups.ts` `isUnread`.
- Needs you: `waitingOnYou`(승인·질문·Reply needed) 세션은 검색창 아래 `Needs you` 묶음에만 보이고 폴더 묶음에서는 빠진다. approval → question → reply, 같은 상태는 오래 기다린 순. 정렬 기준과 무관하게 맨 위, 비면 안 그림, 접기·끌기 없음, 행에 폴더 이름. 예전 "내 차례 묶음을 앞으로" 정렬은 없앴다 (`splitNeedsYou`).
- 채팅 입력창 히스토리: 위/아래 화살표로 이 채팅의 이전 요청을 불러온다 (resume한 기록 포함, 연속 중복 합침, 이미지만 보낸 것 제외). 위는 첫 줄, 아래는 마지막 줄에서만, 맨 아래에서 쓰던 초안 복원. 슬래시 메뉴가 열렸거나 IME 조합 중이거나 수정키가 눌리면 동작하지 않는다. TUI 칸은 Hermes 자체 히스토리를 쓴다.
- 서브에이전트: 채팅 보기에서 `delegate_task` 줄 아래에 자식 목록(목표, 지금 도구, 도구 수, 경과/걸린 시간, 펼치면 요약과 마지막 출력). 출처는 게이트웨이 `subagent.*` 프레임(`__fixtures__/delegate.jsonl`, 실제 녹화). 비동기라 부모 턴이 끝난 뒤에도 갱신되고 부모의 running에는 영향을 주지 않는다. 진행 중인 자식은 패널 행에도 보인다(`liveSubagents.ts`, 칸 id 기준). 훅 상태 파일의 `subagents`는 비동기 위임에서 채워지지 않는다(확인함). resume한 기록에는 자식이 없다.
- 상태별 보기: 정렬 메뉴의 Group by에서 Folder/Status. Status는 Needs you, Working, Unread, Done, Idle, 맨 아래 Recent 하나. 이때 정렬은 고정(`perch.sessionGroupBy`, `groupByStatus`).
- 백그라운드 작업: Hermes `/background`는 부모 링크 없는 별도 `bg_` 세션을 만든다(state.db parent_session_id도 비어 있음, 확인함). perch-hook이 상태 파일에 `PERCH_PANE`을 `pane`으로 남기고, 백엔드가 그 칸의 세션을 `parentId`로 준다. 채팅 보기는 `prompt.background` 응답의 task_id로 잇는다. 패널에서는 부모 행 아래 `└ Background ·` 줄, 부모를 모르면 `Background` 태그. 채팅 `/background`, `/bg`는 `prompt.background`로 보낸다.
- 서브에이전트 그래프 (2026-11-20): 서브에이전트나 백그라운드 자식이 있으면 칸 머리줄에 `Network` 버튼(실행 중 수). 누르면 그 칸 안에 그래프가 붙는다. 붙는 곳은 오른쪽(360px) 또는 아래(45%)이고, 그래프 머리줄을 끌어 옮긴다(`perch.graphDock`, 전역). 고른 적이 없으면 칸 폭 760px 이상일 때 오른쪽, 칸 폭 560px 미만이면 늘 아래. 오른쪽은 세로 들여쓴 트리(한 줄에 노드 하나, 레벨마다 32px 들여쓰기, 부모 아래에서 꺾여 들어가는 선), 아래는 같은 레벨을 같은 간격으로 옆에 놓고 하위는 부모 아래 줄에서 시작한다(사용자 결정). 순서는 루트, `delegate_task` 호출별 자식(각 자식 바로 뒤에 그 하위), 마지막 백그라운드. 중첩은 게이트웨이 `subagent.*`의 `parent_id`/`depth`로 잇는다(Hermes TUI와 같은 방식, 깊이 제한 없음). 손자는 채팅의 `delegate_task` 줄 목록에는 넣지 않는다. 노드 첫 줄 상태 아이콘+제목, 둘째 줄 실행 중이면 오브+지금 작업(아니면 `N agents · N tools · 경과`), 셋째 줄 모델 배지. 점선 테두리는 시작 전·끝난 노드만. 서브에이전트 노드를 누르면 요약과 마지막 출력, 백그라운드 노드는 그 세션으로 포커스. Esc는 그래프 안에 포커스가 있을 때만 닫는다. 패널 행의 `N agents`와 `└ Background` 줄로도 연다. 채팅 칸은 `ChatView`가 끝난 자식까지 `setPaneGraph`로 올리고, TUI 칸은 `bg_` 자식과 훅 `subagents`만 보인다. 배치는 `paneGraph.ts` `graphRows`/`layoutGraph`(라이브러리 없음). 도크를 바꿔도 이미 열린 다른 칸은 다시 열 때 따라간다. 그래프 버튼과 닫기 버튼은 `mousedown`에 반응한다(WKWebView에서 입력창에 포커스가 있을 때 `pointerdown`이 빠지거나 `click`이 칸으로 가는 것을 확인함, 키보드는 `click`).

## 5. 반드시 지킬 규칙

- **Claude Code 설정과 훅(`~/.claude/`)은 절대 건드리지 않는다.** 대상은 Hermes와 OpenCode 설정뿐이다. 이 프로젝트 초기에 Claude Code 훅을 등록했다가 훅 파일이 없어지면서 모든 도구 호출이 차단된 사고가 있었다.
- **에이전트 훅은 어떤 경우에도 에이전트 작업을 막으면 안 된다.**
  - 훅 명령은 실행 파일(`.exe`, macOS는 컴파일된 바이너리)로만 등록한다. `python x.py` 형태는 금지다. 파일이 없으면 python이 exit 2를 내고, Hermes는 `pre_tool_call`의 exit 2를 도구 차단으로 처리한다.
  - 항상 exit 0으로 끝내고, stdout에는 아무것도 쓰지 않는다. `fail_closed`는 쓰지 않는다.
  - perch-hook은 `PERCH_PANE`을 읽어 상태 파일에 칸 id를 쓴다(값이 안전할 때만, 실패해도 무시).
  - Hermes 소스(`agent/shell_hooks.py`)에서 확인한 동작: 훅 실행 실패와 시간 초과는 통과(fail open)이고, exit 2만 차단이다.
- **실행 중 네트워크 접속 금지.** 자동 업데이트, 텔레메트리, CDN 폰트를 쓰지 않는다. 대상 PC가 오프라인이다.
- **README는 작업과 함께 관리한다.** 화면에 보이는 동작을 바꾸는 PR은 README의 기능 설명도 같이 고친다. 릴리스마다 README를 다시 쓴다(`docs/VERSIONING.md`의 절차). README에는 소개, 설치, 기능, 기여 방법, 라이선스만 둔다. 현재 상태나 진행 단계는 이 문서에 쓴다.
- **디자인은 unslop 규칙을 따른다.**
  - 중립 회색 + 강조색 1개, 1px 헤어라인, 4px 격자, 굵기 400/500
  - 그라데이션, 글로우, 이모지 아이콘 금지
  - 애니메이션은 세 곳만 쓴다: 패널의 작업중 상태 점 깜빡임, 칸 상단 생각 중, 칸 하단 진행 줄, 그리고 서브에이전트 그래프의 실행 중 노드 오브(사용자 요청, 2026-11-20)
- **작업 방식(사용자 지시):**
  - 감독 모델이 계획과 검토를 맡고, 코드 작성은 Sonnet 서브에이전트에 맡긴다. 지시는 파일, 동작, 완료 기준까지 명확하게 내린다.
  - UI를 먼저 검증한다.
  - 사용자에게 하는 설명은 한국어로 한다.

## 6. 다음에 할 일

**릴리스.** 최신은 `v0.10.2`(끝난 서브에이전트 숨기기, 한글 입력기 첫 클릭·이미지 문구 수정)이고 릴리스 노트는 `docs/releases/v0.10.2.md`다. 직전 `v0.10.1`의 노트는 `docs/releases/v0.10.1.md`다. 이전 `v0.1.0`은 2026-11-18에 [Releases](https://github.com/Isaac-Lee/Perch/releases)에 게시됐다 (`Perch_0.1.0_x64-setup.exe`, `Perch_0.1.0_aarch64.dmg`). 태그 빌드는 초안 릴리스에 설치 파일을 붙이고, 확인 뒤 `gh release edit v<버전> --draft=false --latest`로 게시한다. 다음 버전은 `tauri.conf.json`, `Cargo.toml`(앱과 `hook/`), `package.json`과 두 lock 파일의 버전을 올리고 `v<버전>` 태그를 push하면 같은 과정이 돈다. v0.3.0 준비 커밋도 이 파일들만 고쳤다. 버전 번호는 `docs/VERSIONING.md` 규칙을 따른다.

- 라이선스는 MIT + Commons Clause다 (`LICENSE`). 회사 내부 사용은 허용, 판매는 금지 (사용자 결정, 2026-11-18).
- Intel 맥용 빌드는 없다. 필요하면 워크플로 matrix에 줄을 추가한다.

**채팅 보기에 더한 것 (v0.4.0)**
- 코드 블록 구문 강조 (diff 포함)
- 슬래시 명령 자동완성과 실행
- 추론 강도 선택
- 모델 목록에 인증되지 않은 provider와 현재 모델 표시
- 작업 중 한 줄 상태 표시 (구슬, 지금 하는 일, 경과 시간). 깜빡이는 커서는 없앴다.
- 연달은 도구 호출은 한 줄로 묶인다. 누르면 펼쳐진다.
- 모델의 추론은 접힌 "생각" 줄로 보인다. 모델이 추론을 보낼 때만 나온다.
- 도구 줄을 펼치면 인자, diff, 결과가 보인다.
- 입력창의 빛나는 테두리 효과(border-beam)는 없앴다.

**그 밖에 더한 것 (v0.4.0)**
- 설정에서 테마를 고른다: Dark, Midnight, Black, Light. Light에서도 터미널 칸은 어두운 색을 유지한다.
- 세션 행의 X는 목록에서 내리기(Recent로)만 한다. 보관은 별도 버튼이다.
- 모든 칸 머리줄에 종류 아이콘이 나오고, New session 메뉴와 같은 아이콘을 쓴다.
- 답변이 질문으로 끝나면 Done 대신 Reply needed로 나온다. 답변 끝의 물음표를 보는 추정이다.
- 답변이 끝난 뒤 늦게 온 이벤트로 Thinking에 고착되던 문제를 고쳤다. Stop을 누르면 멈춘 표시가 풀린다.
- 칸은 가로로 나란히 놓인다 (열 최소 폭 380px). 자리가 없으면 열 안에서 위아래로 쌓인다. 칸 머리줄을 끌어 다른 칸의 가장자리에 놓으면 배치가 바뀐다. 배치는 저장된다.
- 사이드바 세션은 끌어서 순서를 바꿀 수 있다 (같은 폴더 안에서). 정렬 기준은 Status, Recent activity, Name, Manual order.
- 사용량 그래프 막대에 마우스를 올리면 정확한 토큰 수가 나온다. 큰 수는 B 단위로 줄여 쓴다.

**채팅 보기의 알려진 한계**
- resume으로 다시 연 도구 줄에는 걸린 시간이 없다 (기록에 시간이 없다).
- 연결이 끊기면 자동 재연결은 한 번뿐이다. 그 뒤에는 "다시 연결" 버튼을 눌러야 한다.
- 코드 블록 구문 강조는 직접 만든 간단한 토크나이저다. 언어 문법을 정확히 따르지 않는다. 정확도가 필요하면 highlight.js로 바꾼다.
- `/new`, `/clear`, `/resume`, `/branch`, `/compress`, `/undo`, `/retry`, `/quit`는 채팅 보기에서 쓸 수 없다. 게이트웨이가 받지 않는다. 필요하면 TUI 칸을 쓴다.
- 모델 목록에 없는 모델(사내 모델 등)은 `/model <이름> [--provider <slug>]`로 지정한다. 사내 모델 환경에서는 아직 확인하지 못했다.
- 한 줄 상태 표시, 생각 줄, 도구 상세, 슬래시 팝업은 실제 앱에서 충분히 확인하지 못했다.
- Hermes가 턴을 끝내지 않고 멈춘 경우: 사용자 PC에서 "Thinking"이 계속 남는 보고가 있었으나 재현하지 못했다. Perch는 게이트웨이의 `session.info.running`을 따르고, 45초 동안 프레임이 없으면 `session.resume`으로 확인한다. Stop 뒤 3초 안에 끝나지 않으면 "Hermes가 이 턴을 아직 끝내지 않았습니다"라고 알리고, Stop을 한 번 더 누르면 Perch의 표시만 정리한다(Hermes 쪽 턴은 계속될 수 있고, 다음 프레임이 오면 표시가 다시 켜진다). 원인 확인용 증거: Hermes `agent.log`의 "tui prompt accepted" 줄과 짝이 되는 "tui turn finished" 줄이 있는지 본다. 짝이 없으면 Hermes 쪽에서 멈춘 것이다.
- 훅 목록은 앱 시작 때 오래된 것이 있으면 자동으로 갱신한다(다른 hooks가 config.yaml에 있으면 실패하고, 설정 창에 Update 버튼이 나온다). 실행 중인 gateway는 새 세션을 만들거나 resume할 때 config.yaml을 다시 읽는다.
- resume한 대화에는 서브에이전트 목록이 없다 (게이트웨이 snapshot에 정보가 없다).

**4단계: OpenCode 연결 — 하지 않기로 했다 (사용자 결정, 2026-11-18).** OpenCode는 칸에서 실행만 되고 상태 표시는 없다. 나중에 다시 하게 되면 `docs/ADAPTERS.md`를 따른다.

**5단계: 오프라인 Windows 10 설치 검증 (사용자가 직접).** 설치 파일은 이미 만들어진다. 깨끗한 Windows 10에서 설치, 실행, Hermes 연결을 확인한다. 설치 후에는 훅 경로가 달라지므로 앱에서 Connect를 다시 눌러야 한다.

**미뤄 둔 것**
- 작업 중일 때 같은 구슬 아이콘이 칸 머리줄과 채팅 상태 줄 두 곳에 나온다. 중복이라 하나로 줄일지 나중에 정한다 (사용자 결정, 2026-11-18).
- 열 너비와 칸 높이를 끌어서 조절하는 기능은 없다.
- 메모리 줄이기. 셸 8칸 유휴 400MB(작업 집합 합계), 공유분 제외 117MB. 기준은 500MB로 올려 두었다.
- 출력이 계속 쏟아질 때의 흐름 제어. 지금은 읽기를 4ms 모아 보내고 한도(1024 조각)에서 읽기가 멈춘다. 8칸 동시 폭주에서 프레임 간격 최대 104ms.
- 대화 기록 검색은 하지 않기로 했다. 검색은 세션 제목·폴더·브랜치만 본다 (사용자 결정).

## 7. macOS에서 작업할 때 알아둘 점

- 2026-11-18 맥(Node 26)에서 `npm install`과 `npm test`가 통과했다. 앱 창(`tauri dev`)은 이 맥에 Rust가 없어 아직 실행하지 못했다.
- 터미널 글꼴 대체 목록에 Menlo가 들어 있다. UI 글꼴 대체 목록에는 Apple SD Gothic Neo가 들어 있다.
- Hermes 설치 경로가 다르다.
  - Windows 빌드 PC: `D:\hermes-cli`, `HERMES_HOME=D:\hermes-cli\home`
  - macOS 기본값: `~/.hermes`
  - Windows용 오프라인 Hermes 설치 파일 작업은 별도 세션에서 `D:\ysl\hermes-offline`에 진행했다. 이 저장소에는 없다.
- 코드에서 경로 구분자와 홈 폴더를 OS별로 처리해야 한다. 가짜 데이터의 경로는 Windows 형식(`D:\ysl\...`)이다. `folderName()` 같은 경로 처리는 `/`와 `\` 둘 다 다루는지 확인한다.
- 다른 프로세스의 콘솔 제목을 바꾸는 방식(`dash.py tab`의 Windows 전용 코드)은 Perch에서는 필요 없다. 앱이 칸을 직접 가지기 때문이다.
- 대상 사용자 환경은 Windows 10 오프라인 PC다. macOS는 개발용이므로, 2~3단계의 기능은 Windows에서도 한 번씩 확인해야 한다.

## 8. 아직 확인하지 못한 것

- **승인 버튼.** 패널의 Allow/Deny는 Hermes 승인 메뉴에 `1`(Allow)과 Esc(Deny)를 보낸다. 이 PC의 Hermes가 승인 없이 실행하는 설정이라 승인 대기가 생기지 않아 확인하지 못했다. 승인 대기가 어떤 훅 이벤트로 오는지도 같은 이유로 미확인.
- 서브에이전트와 todo 표시: 실제 Hermes에서 본 적이 없다. todo 도구의 인자 형태는 추정이다.
- 실제 키보드로 누른 단축키, 터미널에 포커스가 있을 때 앱이 먼저 받는지.
- Tabby와의 메모리 비교.
- WebView2의 WebGL 컨텍스트 상한 (8칸까지는 문제없었다).
- macOS: CI에서 빌드와 테스트는 통과했다. 실제 맥에서 실행해 본 적은 없다 (터미널, Hermes 연결, 폴더 선택창, 단축키의 ⌘ 표기 모두 미확인).
- 5단계 설치 검증을 어디서 할지 (Windows 10 가상머신 또는 실제 오프라인 PC).

## 9. 사소하지만 알아둘 것

- 훅 실행 파일이 없어도 Hermes는 정상 동작한다 (실제로 확인함: 로그에 `shell hook failed … command not found` 경고만 남고 요청은 처리됐다).
- **설치 파일을 Claude 데스크톱 앱의 셸에서 실행하면 안 된다.** 그 셸은 `%LOCALAPPDATA%`에 새로 쓰는 파일을 앱 전용 가상 폴더(`Packages\Claude_…\LocalCache\Local`)로 돌린다. 설치는 된 것처럼 보이지만 Hermes 같은 바깥 프로세스는 훅 파일을 찾지 못한다. 설치 검증은 탐색기에서 설치 파일을 직접 실행해서 한다. 설치 파일 자체는 조용한 설치(`/S`), 실행, 제거(`uninstall.exe /S`)까지 동작했다.

- 프로젝트 이름은 Perch다 (이전 이름은 `my-custom-agent`). 저장소 주소는 `Isaac-Lee/Perch`다. 앱 폴더는 `desk/`다.
- 초기 Python 프로토타입(`prototype/dash.py`)은 `perch-hook`이 대체해서 지웠다. 필요하면 git 기록(`03e610d`)에서 찾는다.
- README 스크린샷은 headless Edge로 찍었다. macOS에서는 Chrome으로 같은 방식을 쓸 수 있다: `--headless=new --window-size=1600,1000 --virtual-time-budget=6000 --screenshot=<경로> <URL>`
- Vite 개발 서버가 파일을 크게 고친 직후 빈 모듈을 내보낸 적이 있다. 화면이 비면 파일을 다시 저장하거나 서버를 재시작한다.

## 10. 다음 세션을 시작할 때 쓸 프롬프트

새 PC에서 Claude Code를 열고 아래를 그대로 붙여 넣으면 된다. 마지막 줄만 하려는 일로 바꾼다.

```text
이 저장소는 Perch다. 먼저 docs/HANDOFF.md를 읽고 지금 상태를 파악해.
계획 문서는 docs/superpowers/plans/, 설계는 docs/superpowers/specs/, 다른 에이전트 연결 계약은 docs/ADAPTERS.md에 있어.

작업 방식:
- 너는 설계, 계획, 검토를 맡고 구현은 Sonnet 서브에이전트에 맡겨. 지시는 수정할 파일, 동작, 완료 기준, 보고 형식까지 명확하게 내려. 토큰을 아끼기 위해서야.
- 구현 전에 계획을 먼저 알려 줘. 다이어그램을 적극적으로 써.
- 서브에이전트의 보고를 그대로 믿지 말고 테스트와 실제 앱으로 직접 확인해.
- 설명은 한국어로, 짧게.
- HANDOFF.md 5절의 규칙을 지켜. 특히 ~/.claude는 건드리지 말고, 훅은 어떤 경우에도 에이전트를 막으면 안 돼.

오늘 할 일: <여기에 적는다. 예: 맥에서 앱 실행 확인 / 승인 버튼 확인 / 메모리 줄이기>
```

상황별로 덧붙이면 좋은 말:
- 맥에서 처음 실행할 때: "desk에서 npm install, npm test, npm run tauri dev 순서로 돌려서 맥에서 처음 실행해 보는 거야. 8절의 macOS 미확인 항목을 하나씩 확인해."
- Hermes를 실제로 건드릴 때: "실제 Hermes 설정을 바꾸거나 gateway를 재시작하기 전에는 먼저 물어봐."
- 설치 파일을 시험할 때: "설치 파일은 네 셸에서 실행하지 말고 내가 탐색기에서 실행할게. 9절의 가상 폴더 문제 때문이야."

