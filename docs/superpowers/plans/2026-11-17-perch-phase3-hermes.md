# Perch 3단계 계획 — Hermes 연결

날짜: 2026-11-17 · 기준: 설계 문서 5.1, 5.2, 5.4 · 선행: 2단계(완료)

## 0. 공통 규칙

- 자기 작업 절과 0~2절만 읽는다. "수정 파일" 밖은 고치지 않는다. 커밋하지 않는다.
- `~/.claude/` 아래는 읽지도 고치지도 않는다.
- **실제 Hermes 설치(`%LOCALAPPDATA%\hermes`)의 파일을 고치거나 `hermes` 명령을 실행하지 않는다.** 테스트는 임시 폴더를 HERMES_HOME·PERCH_HOME으로 써서 한다. 실제 설치에 연결하는 일은 감독자가 사용자 확인을 받은 뒤 한다.
- 훅은 어떤 경우에도 에이전트를 막지 않는다: 항상 exit 0, stdout에 아무것도 쓰지 않는다, `fail_closed`를 쓰지 않는다.
- 실행 중 네트워크 접속 금지. 유휴 상태에서 자원을 쓰는 것은 상태 폴더 폴링 하나뿐이다.
- 추상화를 미리 만들지 않는다. 보고는 10줄 이하.
- cargo: `export PATH="$HOME/.cargo/bin:$PATH"`. `cargo test`가 기본 target에서 LNK1104로 실패하면 `CARGO_TARGET_DIR`를 scratchpad의 다른 폴더로 지정한다. 테스트에는 타임아웃을 둔다.

## 1. 확인된 Hermes 사실 (v0.23.2, 이 PC의 소스로 확인)

경로는 `H = %LOCALAPPDATA%\hermes\hermes-agent` 기준.

- HERMES_HOME 기본값(Windows): `%LOCALAPPDATA%\hermes` (`H\hermes_constants.py:66-76`). macOS/Linux: `~/.hermes`.
- 실행 파일: `<HERMES_HOME>\bin\hermes.exe`. PATH에 없을 수 있다.
- 에이전트 루프와 훅은 CLI가 아니라 상주 gateway 프로세스에서 돈다. 칸의 환경변수(`PERCH_PANE`)는 훅에 전달되지 않는다. 훅 페이로드의 `cwd`는 gateway의 cwd라 쓰지 않는다.
- 훅 등록: `config.yaml` 최상위 `hooks:` 아래 `이벤트명: [ { command, timeout } ]` (`H\agent\shell_hooks.py:369-450`). `command`는 argv로 분리되어 `shell=False`로 실행된다.
- 승인 목록: `<HERMES_HOME>\shell-hooks-allowlist.json`, 형식 `{"approvals":[{"event","command","approved_at"(UTC ISO),"script_mtime_at_approval"}]}`. gateway는 승인되지 않은 훅을 건너뛴다.
- 훅 stdin JSON: `{hook_event_name, tool_name, tool_input, session_id, cwd, profile, extra}`. 이벤트별 추가 값은 `extra`에 있다.
  - `on_session_open`: `extra.reason` = create | resume, `extra.platform`
  - `pre_llm_call`: `extra.user_message`(요청 전문), `extra.conversation_history`(전체 — 클 수 있다)
  - `pre_tool_call`: 최상위 `tool_name`, `tool_input`
  - `post_tool_call`: 위 + `extra.result`, `extra.status`
  - `on_human_input_request` / `on_human_input_resolved`: `extra.kind`, `extra.request_id`, `extra.prompt`
  - `on_session_end`: **턴이 끝날 때마다** 발화한다 (세션 종료가 아니다)
  - `on_session_finalize`: 세션 종료. `on_session_delete`: 삭제 (`extra.deleted_ids`가 있을 수 있다)
  - `subagent_start`: `extra.parent_session_id`, `child_session_id`, `child_role`, `child_goal`
  - `subagent_stop`: `extra.parent_session_id`, `child_session_id`
  - `pre_api_request`는 등록하지 않는다 (페이로드가 매우 크고, 상태는 다른 이벤트로 충분하다).
- exit 2는 `pre_tool_call`에서만 차단이다. 실패·타임아웃은 통과.
- 세션 저장소: `<HERMES_HOME>\state.db` (SQLite, WAL). `sessions` 테이블: `id`(`local-<64hex>`), `title`, `title_source`, `cwd`, `git_repo_root`, `git_branch`, `model`, `started_at`(epoch 초), `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `reasoning_tokens`, `api_call_count`, `estimated_cost_usd`, `actual_cost_usd`, `parent_session_id`. `title`은 NULL일 수 있다.
- CLI 시작 배너에 `Session: <id>`가 찍힌다 (`H\hermes_cli\banner.py:626`). 22자 접두로 줄여 찍을 수 있다.
- resume: `hermes --resume <id>`.
- 승인 화면은 선택 메뉴다: 1 once, 2 session, 3 always, 4 deny (명령이 길면 5 view). 숫자키 또는 화살표+Enter. `/approve` 명령은 CLI에 없다.
- 중지: Ctrl+C.

실제 Hermes로 확인한 것 (2026-11-18, 이 PC):
- **훅은 gateway가 시작할 때 읽는다.** `config.yaml`에 훅을 추가한 뒤 `hermes gateway stop`으로 gateway를 내리면 다음 CLI 실행 때 새 설정으로 다시 뜬다. 재시작 전에는 CLI 프로세스가 내는 `on_session_open`만 온다.
- 배너에는 `Session: 700823b0`처럼 `local-`을 뗀 8자 접두가 찍힌다. 칸과 세션은 정상 연결됐다.
- 한 턴에서 상태가 idle → thinking → tool(read_file, 인자 표시) → thinking → idle로 바뀌었다. 제목(`sessions.title`), 토큰, 비용이 state.db에서 들어온다.
- `state.db`의 `git_repo_root`, `git_branch`는 비어 있었다. 앱이 `cwd`에서 직접 계산한다.
- Ctrl+C 두 번으로 Hermes가 종료되고 `on_session_finalize`가 와서 closed가 된다. `--resume <id>`로 다시 열면 이전 대화가 이어진다.
- 훅 실행 시간: 작은 페이로드 9.5ms, 2MB 페이로드 15.6ms (릴리스 빌드, 50회 평균).

아직 확인 못 한 것:
- 승인 메뉴에 숫자키 하나(`1`, `4`)를 보내면 바로 확정되는지. 이 PC의 Hermes는 승인 없이 명령을 실행하도록 설정돼 있어 승인 대기가 생기지 않았다. 승인 대기가 `on_human_input_request`로 오는지도 같은 이유로 미확인.
- 훅 exe를 지운 상태에서 도구가 정상 실행되는지 (소스상으로는 실행 실패 = 통과).
- 앱을 설치 경로로 옮기면 훅 경로가 달라진다. 지금 `connected` 판정은 표시 블록 유무만 보므로, 경로가 다른 블록을 "연결됨"으로 본다. 설치본에서는 Disconnect 후 다시 Connect해야 한다.

## 2. 계약

### 2.1 상태 파일 (훅이 쓰고 앱이 읽는다)

위치: `<PERCH_HOME>/sessions/hermes-<sessionId>.json`. `PERCH_HOME` 기본값은 `~/.perch`.

```json
{
  "agent": "hermes", "sessionId": "local-…",
  "state": "thinking",            // thinking | tool | approval | question | idle | closed
  "since": 1794925073,            // state가 시작된 시각 (epoch 초)
  "turnStart": 1794925070,        // null 가능
  "lastTurn": 42,            // 마지막으로 끝난 턴에 걸린 초. 없으면 null
  "steps": 3,
  "tool": "terminal", "toolDetail": "npm test",   // toolDetail 최대 80자
  "prompt": "실패하는 테스트를 …",                 // 마지막 요청 앞 80자
  "pending": { "kind": "approval", "id": "…", "text": "…" },   // 없으면 null
  "subagents": { "<childId>": { "role": "leaf", "goal": "…", "start": 1794925000 } },
  "todos": [ { "text": "…", "status": "pending" } ],            // pending | in_progress | done
  "seen": 1794925073
}
```

이벤트 → 상태:

| 이벤트 | 변경 |
|---|---|
| `on_session_open`, `on_session_start` | 파일이 없으면 만든다 (`state: idle`). 있으면 `seen`만 갱신 |
| `pre_llm_call` | `turnStart = now`, `steps = 0`, `prompt`, `state = thinking`, `pending = null` |
| `pre_tool_call` | `state = tool`, `tool`, `toolDetail`, `steps += 1` |
| `post_tool_call` | `state = thinking`. 도구 이름이 `todo`면 `todos` 갱신 (인자 형태를 모르면 건드리지 않는다) |
| `on_human_input_request` | `state = approval`(kind가 approval 계열) 또는 `question`, `pending` 설정 |
| `on_human_input_resolved` | `pending = null`, `state = thinking` |
| `on_session_end` | `state = idle`, `lastTurn = now - turnStart`, `turnStart = null`, `tool = ""`, `toolDetail = ""` |
| `on_session_finalize` | `state = closed` |
| `on_session_delete` | 파일 삭제 (`deleted_ids`가 있으면 그 파일들도) |
| `subagent_start` | **부모** 파일의 `subagents[childId]` 추가 |
| `subagent_stop` | **부모** 파일의 `subagents[childId]` 제거 |

- 상태가 바뀔 때만 `since`를 갱신한다. 모든 이벤트에서 `seen = now`.
- 자식(서브에이전트) 세션 자신의 이벤트: `subagent_start`로 알려진 `childId`의 이벤트는 자식 파일을 만들지 않고, 부모 파일의 `subagents[childId].tool`만 갱신한다. 자식→부모 대응은 `<PERCH_HOME>/sessions/.children/<childId>` 파일(내용: 부모 id)로 기록한다.
- 쓰기는 원자적으로 한다: 같은 폴더의 임시 파일에 쓰고 rename. 동시 갱신은 `<파일>.lock`을 `create_new`로 잡아 직렬화한다 (최대 200ms 재시도 후에는 잠금 없이 진행, 2초 넘은 잠금 파일은 버려진 것으로 보고 지운다).

### 2.2 Tauri 명령·이벤트 (2단계 계약에 추가)

| 이름 | 인자 → 반환 | 동작 |
|---|---|---|
| 이벤트 `desk://sessions` | 페이로드 `SessionInfo[]` | 상태 파일 또는 state.db 보강값이 바뀌었을 때만 보낸다 |
| `sessions_snapshot` | → `SessionInfo[]` | 현재 값 |
| `pane_create` | `agent, cwd, resume?: string` → `paneId` | `resume`이 있으면 `hermes --resume <id>`로 띄우고 그 세션에 바로 연결한다 |
| `session_approve` | `sessionId, allow: bool` → 없음 | 연결된 칸이 있고, 상태가 approval이고, pending이 있을 때만 PTY에 `"1"`(allow) 또는 `"4"`(deny)를 쓴다. 조건이 안 맞으면 Err |
| `hermes_status` | → `{ home: string, exe: string \| null, connected: bool, hookPath: string }` | 연결 상태 |
| `hermes_connect` / `hermes_disconnect` | → `hermes_status`와 같은 값 | config.yaml 블록과 allowlist 항목을 넣거나 뺀다 |

```ts
type SessionInfo = {
  // 상태 파일 그대로
  agent: "hermes"; sessionId: string; state: string; since: number; turnStart: number | null; steps: number;
  tool: string; toolDetail: string; prompt: string; pending: { kind: string; id: string; text: string } | null;
  subagents: { id: string; role: string; goal: string; start: number; tool?: string }[];   // 맵을 배열로
  todos: { text: string; status: string }[]; seen: number;
  // 백엔드가 보강
  paneId: string | null;          // 연결된 칸 (어느 창이든)
  title: string | null; cwd: string; repoRoot: string | null; branch: string | null;   // state.db, 없으면 칸의 값
  usage: { model: string; input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number; apiCalls: number; costUsd: number | null; startedAt: number } | null;
};
```

`PaneInfo`에 `sessionId: string | null`을 추가한다 (연결된 Hermes 세션).

## 3. 작업

### H1. 훅 바이너리 `perch-hook`

수정 파일: `desk/src-tauri/hook/**` (신규 crate), `desk/src-tauri/Cargo.toml`(workspace 설정만)

- 별도 crate `desk/src-tauri/hook` (패키지 이름 `perch-hook`, 의존성은 `serde_json`만). `src-tauri/Cargo.toml`에 `[workspace] members = [".", "hook"]`.
- 실행: `perch-hook hermes` — stdin JSON을 읽어 2.1대로 상태 파일을 갱신한다. 인자가 없거나 다르면 아무것도 하지 않는다.
- `PERCH_HOME` 환경변수를 따르고 없으면 홈의 `.perch`.
- `main`은 모든 오류와 panic을 삼키고 exit 0으로 끝난다 (`std::panic::catch_unwind` + `std::process::exit(0)`). stdout·stderr에 쓰지 않는다.
- 로직은 `lib.rs`의 순수 함수 `apply(state: Value, event: &Value, now: u64) -> Option<Value>`(None = 삭제)로 두고 테스트한다.
- 완료 기준 (`cargo test -p perch-hook`, `cargo build -p perch-hook --release`):
  - 2.1 표의 각 이벤트에 대한 `apply` 테스트
  - 서브에이전트: start → 자식 이벤트가 부모의 `subagents[child].tool`을 갱신 → stop으로 제거
  - 바이너리 테스트(임시 PERCH_HOME): 정상 이벤트 → 파일 생성, 잘못된 JSON·빈 stdin·인자 없음 → exit 0이고 stdout 비어 있음, PERCH_HOME이 쓸 수 없는 경로여도 exit 0
  - 릴리스 바이너리 실행 시간: 작은 페이로드로 50회 평균을 재서 보고한다

### H2. 앱 백엔드: 세션 수집과 연결

수정 파일: `desk/src-tauri/src/sessions.rs`(신규), `hermes.rs`(신규), `desk.rs`, `pty.rs`(명령 결정부만), `lib.rs`, `Cargo.toml`

- `sessions.rs`
  - 500ms마다 `<PERCH_HOME>/sessions/*.json`의 수정 시각을 보고 바뀐 파일만 다시 읽는다. 깨진 파일은 건너뛴다.
  - state.db 보강: `rusqlite`(features `bundled`)로 **읽기 전용**(`SQLITE_OPEN_READ_ONLY`)으로 열어 2.2의 `title, cwd, repoRoot, branch, usage`를 채운다. 상태 파일이 바뀐 세션만 다시 조회한다. DB가 없거나 잠겨 있으면 보강 없이 진행한다.
  - 결과가 직전과 다를 때만 `desk://sessions`를 emit한다.
  - 7일 넘은 상태 파일은 지우지 않는다 (검색에서 제목으로 찾기 위해). 패널에서 숨기는 것은 프런트의 기존 규칙이 한다.
- 칸 ↔ 세션 연결 (`desk.rs`)
  - Hermes 칸의 PTY 출력에서 ANSI 이스케이프를 지운 뒤 `Session: <id>`를 찾는다 (출력 앞 64KB까지만 검사, 찾으면 검사 중단). 찾은 id가 접두(22자)면 상태 파일·state.db의 id 중 그 접두로 시작하는 것에 연결한다.
  - 못 찾으면: 그 칸이 만들어진 뒤 처음 나타난, 다른 칸에 연결되지 않은 `hermes` 세션에 연결한다. 이 추측이 섞이지 않도록 Hermes 칸의 PTY 생성을 직렬화한다 (이전 Hermes 칸이 연결되거나 5초가 지난 뒤 다음 것을 띄운다).
  - `resume`으로 만든 칸은 처음부터 연결돼 있다.
- Hermes 실행 파일 (`hermes.rs`): `HERMES_HOME` 환경변수 → 없으면 OS 기본값. 실행 파일은 PATH의 `hermes` → 없으면 `<home>/bin/hermes(.exe)`. 못 찾으면 칸에 `[Perch] hermes 실행 파일을 찾지 못했습니다`를 보여준다. `pty::command_for`가 이 경로를 쓰게 한다.
- 연결 버튼 (`hermes.rs`)
  - `hookPath`: 앱 실행 파일과 같은 폴더의 `perch-hook(.exe)`.
  - `hermes_connect`: `config.yaml` 끝에 표시 블록을 추가한다.
    ```yaml
    # >>> perch
    hooks:
      on_session_open:
        - command: '"<hookPath>" hermes'
          timeout: 5
      … (2.1 표의 이벤트 전부)
    # <<< perch
    ```
    파일에 이미 최상위 `hooks:`가 있으면(표시 블록 밖) 고치지 않고 Err로 "기존 hooks가 있어 자동으로 합치지 않습니다"와 넣을 내용을 돌려준다. 쓰기 전에 `config.yaml.perch-backup`을 만든다.
  - allowlist에 `(event, command)` 쌍마다 항목을 추가한다 (기존 항목 유지).
  - `hermes_disconnect`: 표시 블록과 그 command의 allowlist 항목을 지운다.
  - `connected`: 표시 블록이 있고 hookPath 파일이 존재할 때 true.
- 완료 기준 (`cargo test`): 임시 폴더로
  - 상태 파일 3개 → 스냅샷 3개, 깨진 파일 무시, 바뀌지 않으면 변경 없음 판정
  - 임시 SQLite에 `sessions` 행을 넣고 보강값 확인, DB 없음 → 보강 없이 통과
  - `Session: <id>` 추출: ANSI 섞인 출력, 접두 id, 없는 경우
  - connect → 블록·allowlist 생성, 다시 connect → 중복 없음, disconnect → 원래 내용과 동일, 기존 `hooks:` 있으면 Err이고 파일 불변
  - 실행 파일 탐색 3가지 경우

### H3. 프런트

수정 파일: `desk/src/lib/backend.ts`, `useTauriDesk.ts`, `types.ts`, `components/SettingsMenu.tsx`, `App.css`

- `useTauriDesk`: `sessions` = 백엔드 `SessionInfo`를 `Session`으로 바꾼 것 + 연결된 세션이 없는 칸(셸, 아직 연결 안 된 에이전트 칸)의 `plain` 세션. `paneId`는 이 창의 칸일 때만 넣는다 (2단계와 같다).
- `focusSession`: 연결된 칸이 있으면 그 칸(다른 창이면 그 창)으로, 없으면 `paneCreate("hermes", cwd, sessionId)`로 resume.
- `approve(sessionId, allow)` → `session_approve`. 실패하면 그 세션의 칸으로 포커스만 옮긴다.
- 설정 메뉴에 "Hermes" 묶음: 연결 상태(Connected / Not connected), Connect / Disconnect 버튼, Hermes 폴더 경로, 실패 시 오류 문장(한글). 브라우저 모드에서는 이 묶음을 숨긴다.
- 완료 기준: `npm test` 통과, `npm run build` 성공, 브라우저 모드 그대로 동작.

### H4. 번들

수정 파일: `desk/src-tauri/tauri.conf.json`, `desk/package.json`(스크립트)

- 릴리스 빌드 전에 `perch-hook`을 빌드해 앱 exe 옆에 설치되게 한다 (Tauri `externalBin`: `binaries/perch-hook-<target triple>` 이름 규칙을 맞추는 복사 스크립트 포함). 개발 실행(`tauri dev`)에서도 `hookPath`가 존재하게 한다.

### V. 실제 Hermes로 확인 (감독자, 사용자 확인 후)

1절의 "아직 확인 못 한 것" 4가지와, 훅 exe를 지운 상태에서 도구가 정상 실행되는지.
