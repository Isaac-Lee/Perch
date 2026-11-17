# my-custom-agent

여러 코딩 에이전트(Hermes, OpenCode)를 한 화면에서 띄워 쓰고 상태를 관리하는 개인 작업 환경을 만드는 프로젝트다.

## 현재 상태

| 구성 | 상태 | 위치 |
|---|---|---|
| **Agent Desk** — 분할 터미널 + 세션 상태 패널 데스크톱 앱 (Tauri) | 설계 완료, 구현 전 | [설계 문서](docs/superpowers/specs/2026-11-17-agent-desk-design.md) |
| **dash.py** — Hermes 세션 CLI 대시보드 (프로토타입) | 동작함. Agent Desk 3단계에서 대체 예정 | [dash.py](dash.py), 아래 설명 |

### Agent Desk 요약

설계 문서가 기준이다. 아래는 요약이다.

- 앱 하나에서 `hermes`, `opencode`, 셸을 분할 칸으로 띄운다. 칸 개수 제한은 없고 자동 격자로 배치하며, 창은 여러 개 띄울 수 있다.
- 왼쪽 패널에 모든 창의 세션을 작업 디렉토리(git 저장소)별로 보여준다.
  - 상태: 작업중, 생각중, 도구 실행, 승인대기, 질문대기, 답변대기와 각 경과시간
  - 서브에이전트와 todo
- 패널에서 세션을 누르면 해당 칸으로 이동한다. 닫힌 세션이면 resume으로 연다. Hermes 승인 요청은 패널에서 바로 허용하거나 거절할 수 있다.
- 칸 상단에는 생각 중 표시, 하단에는 진행 줄(지금 하는 일 · N단계 · 경과시간)이 있다.
- 오프라인 Windows 10 PC용 설치 파일을 만든다 (WebView2 포함). macOS는 소스 빌드로 지원한다.
- UI 부품은 [libraries.dev](https://libraries.dev/)(MIT)의 `thinking-orbs`를 쓴다. 디자인은 [unslop](https://github.com/heydamir/unslop)(CC BY 4.0, Damir Sokolovsky)의 규칙을 따른다.
- 에이전트별 지원: 1차는 Hermes와 OpenCode다. oh-my-pi는 나중에 붙인다.

### 다른 PC에서 이어서 작업하기

```bash
git clone https://github.com/Isaac-Lee/my-custom-agent.git
```

빌드 PC에 필요한 것:

| 도구 | 용도 |
|---|---|
| Node 20 이상 | 프론트엔드 |
| Rust (rustup) | Tauri 백엔드 |
| Windows: Visual Studio Build Tools(C++) + Windows SDK | Rust와 네이티브 모듈 빌드 |
| macOS: Xcode Command Line Tools | 같은 용도 |

구현 순서는 설계 문서 7절을 따른다: UI 시제품 → 실제 터미널 칸 → Hermes 연결 → OpenCode 연결 → 오프라인 설치 파일.

### 지켜야 할 규칙

- Claude Code 설정과 훅은 절대 건드리지 않는다. 대상은 Hermes와 OpenCode 설정뿐이다.
- 에이전트 훅은 어떤 경우에도 에이전트 작업을 막으면 안 된다.
  - 훅 명령은 반드시 `.exe`로 등록하고 항상 exit 0으로 끝낸다.
  - `python x.py` 형태는 금지다. 파일이 없으면 python이 exit 2를 내고, Hermes는 이를 도구 차단으로 처리한다.
- 실행 중 네트워크 접속(자동 업데이트, 텔레메트리, CDN)은 없어야 한다.

---

# dash.py (프로토타입)

Hermes Agent 세션을 한눈에 보는 터미널 대시보드다. Tabby 같은 아무 터미널에서 동작한다.

- 세션별 상태: ● 작업중 / ⚠ 승인대기 / ? 질문대기 / ◆ 답변대기, 상태가 이어진 시간
- 지금 쓰는 도구, 마지막 요청
- 서브에이전트 개수, 역할, 목표, 실행 시간
- Tabby 탭 제목에 상태 표시 (`⚠ 승인대기 3m · 폴더명 🤖1`)

Python 표준 라이브러리만 사용한다. Windows는 `dash.exe` 빌드를 쓰면 Python이 없어도 된다.

## 요구 사항

- Hermes Agent 0.23 이상 (셸 훅의 `on_human_input_request`, `subagent_start` 이벤트 필요)
- Windows 10/11 또는 macOS
- Python 3.10 이상. Windows에서 `dash.exe` 빌드를 쓰면 Python이 필요 없다.

## 파일 구성

| 파일 | 설명 |
|---|---|
| `dash.py` | 대시보드, 탭 래퍼, 훅, 설치/제거가 모두 들어 있는 단일 스크립트 |
| `install.cmd` | Windows 오프라인 설치용. 압축 푼 `dash\dash.exe`로 설치를 실행한다 |

명령 요약:

| 명령 | 하는 일 |
|---|---|
| `dash` | 대시보드 (Ctrl+C로 종료) |
| `dash tab [hermes 인자...]` | 탭 안에서 hermes 실행 + 탭 제목 갱신 |
| `dash hook` | Hermes가 호출하는 훅 (직접 실행할 일 없음) |
| `dash install [HERMES_HOME]` | 프로그램 복사 + Hermes 설정에 훅 등록 |
| `dash uninstall [HERMES_HOME]` | Hermes 설정에서 훅 제거 |
| `dash demo` | 자체 점검 |

상태 파일 위치는 `~/.agent-dash/`이다. `AGENT_DASH_HOME` 환경변수로 바꿀 수 있다.

## 동작 방식

Hermes 0.23은 에이전트를 공용 gateway 프로세스에서 실행한다.

1. Hermes `config.yaml`의 셸 훅이 `dash hook`을 호출하고, 세션 상태를 `~/.agent-dash/`에 기록한다.
2. `dash`는 그 파일을 읽어서 화면에 그린다.
3. `dash tab`은 탭 안에서 `hermes`를 실행하고, 자기 세션의 상태를 탭 제목에 쓴다.

일부 이벤트는 일부러 쓰지 않는다. `pre_tool_call`은 실패하면 도구 호출을 막을 수 있으므로 등록하지 않는다. 그 밖의 훅은 오류가 나도 항상 exit 0으로 끝난다.

## 설치

```powershell
# Windows (exe 빌드)
install.cmd D:\hermes-cli\home        # HERMES_HOME 경로. 생략하면 %HERMES_HOME% 또는 ~/.hermes

# 소스로 (Windows/macOS)
python dash.py install ~/.hermes
```

설치 과정은 다음과 같다.

- 프로그램을 `%LOCALAPPDATA%\agent-dash`(macOS는 `~/agent-dash`)에 복사한다.
- Hermes `config.yaml`에 훅 블록을 추가한다. 원본은 `config.yaml.bak-agent-dash`로 백업한다.
- `shell-hooks-allowlist.json`에 승인 항목을 넣는다.

`config.yaml`에 이미 `hooks:` 항목이 있으면 자동으로 합치지 않는다. 대신 직접 넣을 내용을 출력한다. 설치 결과는 `hermes hooks list`로 확인한다.

제거: `dash uninstall <HERMES_HOME>`

## Tabby 설정

Settings → Profiles & connections → New profile → Local terminal에서 프로필 두 개를 만든다.

| 프로필 | Command | 비고 |
|---|---|---|
| Hermes Dash | `%LOCALAPPDATA%\agent-dash\dash.exe` | 화면을 분할해 한쪽에 띄워 둔다 |
| Hermes | `%LOCALAPPDATA%\agent-dash\dash.exe`, Arguments: `tab` | 작업할 폴더를 Working directory로 지정한다 |

- macOS에서는 Command를 `python3`, Arguments를 `~/agent-dash/dash.py tab`처럼 지정한다.
- `tab` 뒤의 인자는 hermes에 그대로 전달된다. 예: `tab --resume <ID>`
- 탭 제목 끝에 붙는 이름은 Working directory의 폴더 이름이다.
- 탭 제목이 바뀌지 않으면 Settings → Appearance(또는 Terminal)에서 터미널이 정하는 동적 탭 제목을 쓰도록 되어 있는지 확인한다. 탭 이름을 직접 바꾼 탭은 제목이 고정된다.

## 로컬 테스트

### 1. 자체 점검 (Hermes 없이)

```powershell
python dash.py demo          # "ok"가 나오면 통과
```

### 2. 가짜 이벤트로 화면 확인 (Hermes 없이)

실제 상태 폴더를 건드리지 않도록 `AGENT_DASH_HOME`을 따로 지정한다.

```powershell
$env:AGENT_DASH_HOME = "$env:TEMP\agent-dash-test"
'{"hook_event_name":"on_session_open","session_id":"S1","profile":"default","extra":{}}' | python dash.py hook
'{"hook_event_name":"pre_llm_call","session_id":"S1","extra":{"user_message":"빌드 고쳐줘"}}' | python dash.py hook
'{"hook_event_name":"subagent_start","session_id":"S1","extra":{"child_session_id":"C1","child_role":"leaf","child_goal":"로그 분석"}}' | python dash.py hook
'{"hook_event_name":"on_human_input_request","session_id":"S1","extra":{"kind":"approval"}}' | python dash.py hook
python dash.py               # ⚠ 승인대기 + 🤖1 표시 확인, Ctrl+C로 종료
```

### 3. 실제 Hermes로

1. `python dash.py install <HERMES_HOME>`을 실행하고, `hermes hooks list`에 훅 11개가 승인된 상태로 나오는지 확인한다.
2. Tabby 탭 A에서 `python dash.py`를 실행한다 (대시보드).
3. Tabby 탭 B, C에서 각각 `python dash.py tab`을 실행한다 (hermes 시작).
4. 각 탭에서 다음을 시켜 보고 대시보드와 탭 제목이 바뀌는지 본다.
   - 일반 요청: 작업중 → 답변대기
   - 위험한 명령: 승인대기
   - 서브에이전트를 쓰는 요청: 🤖 개수가 바뀜
5. 끝나면 `python dash.py uninstall <HERMES_HOME>`을 실행한다.

## 문제 해결

| 증상 | 확인할 것 |
|---|---|
| 대시보드에 아무것도 안 나옴 | `hermes hooks list`에서 agent-dash 훅이 승인(approved) 상태인지 확인한다. 설치 후 새로 연 세션부터 적용된다 |
| 훅이 승인되지 않음 | 설치 명령에 넘긴 HERMES_HOME이 실제 사용하는 프로필 경로가 맞는지 확인한다. 다른 프로필은 `profiles/<이름>/`에 따로 있다 |
| `hooks: 항목이 이미 있음`으로 설치 중단 | 출력된 이벤트 목록을 기존 `hooks:` 아래에 직접 추가하고, `hermes hooks list`에서 승인한다 |
| 탭 제목이 안 바뀜 | Tabby 프로필을 `dash tab`으로 실행했는지, 동적 탭 제목이 켜져 있는지 확인한다 |
| 탭이 엉뚱한 세션을 보여줌 | 탭을 하나씩 열거나 `tab --resume <ID>`로 연다 |
| `hermes`를 못 찾음 | `hermes`가 PATH에 있어야 한다. 새 터미널에서 `hermes --version`을 실행해 확인한다 |

훅 출력은 Hermes 로그(`hermes logs`)에 경고로 남는다. 훅이 실패해도 Hermes 작업은 계속 진행된다.

## 알려진 한계

- 탭과 세션은 "탭을 연 직후 처음 열린 세션"으로 연결한다. 두 탭을 1~2초 안에 동시에 열면 연결이 뒤바뀔 수 있다. 정확하게 연결하려면 `--resume ID`를 쓴다.
- `dash tab` 없이 연 세션(Desktop 등)은 "탭 없음"으로 표시된다. 최근 30분 안에 활동이 있었던 세션만 나온다.

## Windows exe 빌드

```powershell
py -m venv .venv; .venv\Scripts\pip install pyinstaller
.venv\Scripts\pyinstaller --noconfirm --onedir --console --name dash dash.py
# dist\dash 폴더와 install.cmd를 같은 폴더에 두고 zip으로 묶는다
```
