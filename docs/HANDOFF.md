# 인수인계 — Perch (2026-11-18 기준)

다른 PC(주로 macOS)에서 이어서 작업하기 위한 문서다. 이 문서만 읽고 시작할 수 있게 썼다.

## 1. 한 줄 요약

Perch는 여러 코딩 에이전트(Hermes, OpenCode)를 분할 터미널로 띄우고, 옆 패널에서 모든 세션 상태를 지켜보는 데스크톱 앱이다. **1~3단계(UI, Tauri + 실제 터미널, Hermes 연결)는 끝났다. 4단계(OpenCode)와 5단계(오프라인 설치 검증)가 남았다.** 작업 브랜치는 `phase2-tauri-pty`이고 아직 push하지 않았다.

## 2. 지금 있는 것

| 위치 | 내용 | 상태 |
|---|---|---|
| `desk/src/` | 화면 (React 19 + TypeScript). 브라우저에서는 가짜 데이터, Tauri 창에서는 실제 백엔드 | 테스트 31개 통과 |
| `desk/src-tauri/src/` | Rust 백엔드: `pty.rs`(터미널), `desk.rs`(칸·창), `sessions.rs`(상태 수집, state.db 보강), `hermes.rs`(실행 파일 찾기, 연결) | 테스트 29개 통과 |
| `desk/src-tauri/hook/` | `perch-hook`: Hermes 셸 훅이 부르는 작은 바이너리. 상태 파일을 쓴다 | 테스트 3개 통과 |
| `desk/scripts/build-hook.mjs` | 훅을 빌드해 Tauri 사이드카 위치로 복사 (`npm run hook`) | `tauri dev`/`build`가 자동 실행 |
| `docs/superpowers/specs/2026-11-17-perch-design.md` | 설계 문서. 성능 기준은 9절 10번 | 메모리 기준 500MB로 변경됨 |
| `docs/superpowers/plans/` | 단계별 계획. 2단계(`phase2-tauri-pty`), 3단계(`phase3-hermes`: 확인된 Hermes 사실 포함) | 2·3단계 완료 |
| `prototype/dash.py` | 초기 Python 프로토타입 | `perch-hook`이 대체했다. 지워도 된다 |

결과물 (Windows, 이 PC에서 빌드):
- `desk/src-tauri/target/release/perch.exe` — 설치 없이 실행. 같은 폴더의 `perch-hook.exe`가 필요하다.
- `desk/src-tauri/target/release/bundle/nsis/Perch_0.1.0_x64-setup.exe` — 사용자별 설치 파일, WebView2 오프라인 설치본 포함 (216MB). 설치 시험은 아직 안 했다.

## 3. 새 PC에서 시작하기

```bash
git clone https://github.com/Isaac-Lee/Perch.git
cd Perch/desk
npm install
npm test          # 31개 통과해야 한다
npm run dev       # 브라우저 모드 (가짜 데이터) http://localhost:5173
npm run tauri dev # 앱 창 (실제 터미널). Rust 필요
npm run tauri build   # 릴리스 exe와 설치 파일
```

- Node 20 이상이 필요하다 (개발은 Node 26에서 했다).
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
- 아이콘은 `desk/public/icon.svg`다 (횃대 위의 새). `.ico`/`.icns`/`.png`는 아직 없고, 2단계에서 이 SVG로 만든다.
- 화면 언어: 짧은 라벨, 상태, 버튼은 영어로 쓴다. 설명 문장(안내, 툴팁, 설정 설명)은 한글로 쓴다. 사용자 내용은 그대로 둔다.
- 화면에서는 "pane"이라는 말을 쓰지 않는다. 상단 바는 `N open`, 그 밖에는 "session"이라고 쓴다. 코드 안의 이름(Pane 컴포넌트 등)은 그대로 둔다.
- 글꼴은 모두 OFL이고 `desk/public/fonts/`에 들어 있다.
  - UI: IBM Plex Sans(영어) + IBM Plex Sans KR(한글)
  - 터미널 기본: D2Coding (사용자가 유지하기로 결정)
  - 터미널 선택지: Monoplex KR
- 패널 기본 폭은 320px이다 (200~480 범위에서 조절).

**칸 안에서 앱이 그리는 것 (Hermes 자체 화면과 중복을 줄임)**
- 유지: 칸 하단 진행 줄, 칸 상단 생각 중 아이콘, 포커스 테두리, Stop 버튼, 헤더의 상태 점
- 제거: 승인·질문 대기 시 헤더 경고색과 문구, 입력 줄 배경 띠, "입력 중" 라벨
- 만들지 않음: 모델 표시 (Hermes 상태줄에 이미 있음), 별도 입력창 (에이전트의 자동완성과 선택 메뉴를 잃기 때문)
- 승인·질문의 자세한 내용, 입력창, 서브에이전트 독은 Hermes가 터미널 안에 직접 그린다. 앱은 패널에서 요약과 [Allow]/[Deny]만 제공한다.

**추가된 기능**
- 토큰 사용량: 패널 세션 행의 토큰 수, 상단 "Today … tok", 사용량 화면(기간 합계, 14d/30d/1y 차트, 1y는 일별/주별, 프로젝트·모델·에이전트·세션별 표).
  - 방식은 codeburn(MIT)을 참고했고 코드는 새로 썼다.
  - 가격표는 넣지 않는다. 비용은 에이전트가 기록한 값이 있을 때만 표시한다.
- Stop 버튼, 패널 폭 조절, 묶음 접기, 새 세션 기본값(에이전트 + 폴더), 터미널 글꼴/크기 설정, git 브랜치 표시.

## 5. 반드시 지킬 규칙

- **Claude Code 설정과 훅(`~/.claude/`)은 절대 건드리지 않는다.** 대상은 Hermes와 OpenCode 설정뿐이다. 이 프로젝트 초기에 Claude Code 훅을 등록했다가 훅 파일이 없어지면서 모든 도구 호출이 차단된 사고가 있었다.
- **에이전트 훅은 어떤 경우에도 에이전트 작업을 막으면 안 된다.**
  - 훅 명령은 실행 파일(`.exe`, macOS는 컴파일된 바이너리)로만 등록한다. `python x.py` 형태는 금지다. 파일이 없으면 python이 exit 2를 내고, Hermes는 `pre_tool_call`의 exit 2를 도구 차단으로 처리한다.
  - 항상 exit 0으로 끝내고, stdout에는 아무것도 쓰지 않는다. `fail_closed`는 쓰지 않는다.
  - Hermes 소스(`agent/shell_hooks.py`)에서 확인한 동작: 훅 실행 실패와 시간 초과는 통과(fail open)이고, exit 2만 차단이다.
- **실행 중 네트워크 접속 금지.** 자동 업데이트, 텔레메트리, CDN 폰트를 쓰지 않는다. 대상 PC가 오프라인이다.
- **디자인은 unslop 규칙을 따른다.**
  - 중립 회색 + 강조색 1개, 1px 헤어라인, 4px 격자, 굵기 400/500
  - 그라데이션, 글로우, 이모지 아이콘 금지
  - 애니메이션은 세 곳만 쓴다: 패널의 작업중 상태 점 깜빡임, 칸 상단 생각 중, 칸 하단 진행 줄
- **작업 방식(사용자 지시):**
  - 감독 모델이 계획과 검토를 맡고, 코드 작성은 Sonnet 서브에이전트에 맡긴다. 지시는 파일, 동작, 완료 기준까지 명확하게 내린다.
  - UI를 먼저 검증한다.
  - 사용자에게 하는 설명은 한국어로 한다.

## 6. 다음에 할 일

**4단계: OpenCode 연결.** 플러그인(`~/.config/opencode/plugins/`) 또는 로컬 서버 API를 쓴다. 이벤트 이름, resume 플래그, 토큰 DB 컬럼은 실제 설치본으로 확인해야 한다. 이 PC에는 OpenCode가 없다. 상태 파일 형식은 3단계 계획 2.1절과 같고 `agent`만 `opencode`다. 부분 지원(작업중/대기, 도구, 권한 대기)으로 출시해도 된다.

**5단계: 오프라인 Windows 10 설치 검증.** 설치 파일은 이미 만들어진다. 깨끗한 Windows 10에서 설치, 실행, Hermes 연결을 확인한다. 설치 후에는 훅 경로가 달라지므로 앱에서 Connect를 다시 눌러야 한다.

**미뤄 둔 것**
- 메모리 줄이기. 셸 8칸 유휴 400MB(작업 집합 합계), 공유분 제외 117MB. 기준은 500MB로 올려 두었다.
- 출력이 계속 쏟아질 때의 흐름 제어. 지금은 읽기를 4ms 모아 보내고 한도(1024 조각)에서 읽기가 멈춘다. 8칸 동시 폭주에서 프레임 간격 최대 104ms.
- 사용량 화면에서 기록 속 세션을 클릭하면 아무 일도 없다. resume으로 열게 하면 된다.
- 대화 기록 검색은 하지 않기로 했다. 검색은 세션 제목·폴더·브랜치만 본다 (사용자 결정).

## 7. macOS에서 작업할 때 알아둘 점

- 1단계 시제품은 macOS에서 실행해 본 적이 없다. 브라우저 앱이라 그대로 돌 것으로 예상하지만, 확인된 것은 아니다.
- 터미널 글꼴 대체 목록에 Menlo가 들어 있다. UI 글꼴 대체 목록에는 Apple SD Gothic Neo가 들어 있다.
- Hermes 설치 경로가 다르다.
  - Windows 빌드 PC: `D:\hermes-cli`, `HERMES_HOME=D:\hermes-cli\home`
  - macOS 기본값: `~/.hermes`
  - Windows용 오프라인 Hermes 설치 파일 작업은 별도 세션에서 `D:\ysl\hermes-offline`에 진행했다. 이 저장소에는 없다.
- 코드에서 경로 구분자와 홈 폴더를 OS별로 처리해야 한다. 가짜 데이터의 경로는 Windows 형식(`D:\ysl\...`)이다. `folderName()` 같은 경로 처리는 `/`와 `\` 둘 다 다루는지 확인한다.
- 다른 프로세스의 콘솔 제목을 바꾸는 방식(`dash.py tab`의 Windows 전용 코드)은 Perch에서는 필요 없다. 앱이 칸을 직접 가지기 때문이다.
- 대상 사용자 환경은 Windows 10 오프라인 PC다. macOS는 개발용이므로, 2~4단계의 기능은 Windows에서도 한 번씩 확인해야 한다.

## 8. 아직 확인하지 못한 것

- **승인 버튼.** 패널의 Allow/Deny는 Hermes 승인 메뉴에 `1`/`4`를 보낸다. 이 PC의 Hermes가 승인 없이 실행하는 설정이라 승인 대기가 생기지 않아 확인하지 못했다. 승인 대기가 어떤 훅 이벤트로 오는지도 같은 이유로 미확인.
- 훅 exe를 지운 상태에서 Hermes 도구가 정상 실행되는지 (소스상으로는 통과).
- 서브에이전트와 todo 표시: 실제 Hermes에서 본 적이 없다. todo 도구의 인자 형태는 추정이다.
- 실제 키보드로 누른 단축키, 터미널에 포커스가 있을 때 앱이 먼저 받는지.
- Tabby와의 메모리 비교.
- WebView2의 WebGL 컨텍스트 상한 (8칸까지는 문제없었다).
- macOS에서는 2단계 이후 한 번도 빌드하지 않았다.
- OpenCode 전부.
- 5단계 설치 검증을 어디서 할지 (Windows 10 가상머신 또는 실제 오프라인 PC).

## 9. 사소하지만 알아둘 것

- 프로젝트 이름은 Perch다 (이전 이름은 `my-custom-agent`). 저장소 주소는 `Isaac-Lee/Perch`다. 앱 폴더는 `desk/`다.
- `agent-dash-win64.zip`은 `dash.py` 프로토타입의 Windows 빌드다. `.gitignore`로 저장소에서 제외했다.
- README 스크린샷은 headless Edge로 찍었다. macOS에서는 Chrome으로 같은 방식을 쓸 수 있다: `--headless=new --window-size=1600,1000 --virtual-time-budget=6000 --screenshot=<경로> <URL>`
- Vite 개발 서버가 파일을 크게 고친 직후 빈 모듈을 내보낸 적이 있다. 화면이 비면 파일을 다시 저장하거나 서버를 재시작한다.
