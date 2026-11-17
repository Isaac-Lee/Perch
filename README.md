# agent-dash

Hermes Agent 세션을 한눈에 보는 터미널 대시보드. Tabby 같은 아무 터미널에서 동작한다.

- 세션별 상태: ● 작업중 / ⚠ 승인대기 / ? 질문대기 / ◆ 답변대기, 상태가 이어진 시간
- 지금 쓰는 도구, 마지막 요청
- 서브에이전트 개수, 역할, 목표, 실행 시간
- Tabby 탭 제목에 상태 표시 (`⚠ 승인대기 3m · 폴더명 🤖1`)

Python 표준 라이브러리만 사용한다. Windows는 `dash.exe` 빌드를 쓰면 Python이 없어도 된다.

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

- 대시보드용 프로필: 명령은 `dash.exe`(또는 `python dash.py`)로 한다. 화면을 분할해 한쪽에 띄워 둔다.
- Hermes용 프로필: 명령은 `dash.exe tab`이다. 인자는 hermes에 그대로 전달된다. 예: `dash.exe tab --resume <ID>`
- 탭 제목이 바뀌지 않으면 Tabby 설정에서 동적 탭 제목(터미널이 정한 제목 사용)이 켜져 있는지 확인한다.

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

## 알려진 한계

- 탭과 세션은 "탭을 연 직후 처음 열린 세션"으로 연결한다. 두 탭을 1~2초 안에 동시에 열면 연결이 뒤바뀔 수 있다. 정확하게 연결하려면 `--resume ID`를 쓴다.
- `dash tab` 없이 연 세션(Desktop 등)은 "탭 없음"으로 표시된다. 최근 30분 안에 활동이 있었던 세션만 나온다.

## Windows exe 빌드

```powershell
py -m venv .venv; .venv\Scripts\pip install pyinstaller
.venv\Scripts\pyinstaller --noconfirm --onedir --console --name dash dash.py
# dist\dash 폴더와 install.cmd를 같은 폴더에 두고 zip으로 묶는다
```
