# 에이전트 어댑터 붙이기

## 계약
계약은 상태 파일 하나다. 앱은 이 파일만 읽는다.

| 항목 | 내용 |
|---|---|
| 위치 | `<PERCH_HOME>/sessions/<agent>-<sessionId>.json` |
| 필드, 이벤트→상태 규칙 | 아래 "상태 파일" |
| 쓰기 | 임시 파일에 쓰고 rename (원자적) |
| 오류 | 어떤 오류도 에이전트로 던지지 않는다 |

## 상태 파일

위치: `<PERCH_HOME>/sessions/<agent>-<sessionId>.json`. `PERCH_HOME` 기본값은 `~/.perch`. Hermes 예시는 다음과 같다.

```json
{
  "agent": "hermes", "sessionId": "local-…",
  "state": "thinking",            // thinking | tool | approval | question | idle | closed
  "since": 1794925073,            // state가 시작된 시각 (epoch 초)
  "turnStart": 1794925070,        // null 가능
  "lastTurn": 42,            // 마지막으로 끝난 턴에 걸린 초. 없으면 null
  "busyTotal": 120,          // 끝난 턴에 걸린 초의 누적 (새 파일은 0)
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
| `pre_llm_call` | `turnStart = now`, `steps = 0`, `prompt`, `state = thinking`, `pending = null`, `asks = false`, `ask = ""` |
| `pre_tool_call` | 턴이 열려 있을 때만(`turnStart != null`): `state = tool`, `tool`, `toolDetail`, `steps += 1`. 턴 밖에서는 `seen`만 |
| `post_llm_call` | `asks`/`ask` = 응답(`extra.assistant_response`)이 질문으로 끝나는지와 그 질문 한 줄 (`ends_with_question`, 휴리스틱) |
| `post_tool_call` | 턴이 열려 있을 때만 `state = thinking`. 도구 이름이 `todo`면 `todos` 갱신 (인자 형태를 모르면 건드리지 않는다) |
| `on_human_input_request` | `state = approval`(kind가 approval 계열) 또는 `question`, `pending` 설정 |
| `on_human_input_resolved` | `pending = null`. 턴이 열려 있으면 `state = thinking`, 아니면 approval/question이었던 상태만 `idle`로 |
| `on_session_end` | `pending = null`, `state = idle`, `lastTurn = now - turnStart`, `turnStart = null`, `tool = ""`, `toolDetail = ""` |
| `on_session_finalize` | `state = closed` |
| `on_session_delete` | 파일 삭제 (`deleted_ids`가 있으면 그 파일들도) |
| `subagent_start` | **부모** 파일의 `subagents[childId]` 추가 |
| `subagent_stop` | **부모** 파일의 `subagents[childId]` 제거 |

- `subagent_start/stop`의 부모 id는 Hermes가 최상위 `session_id`로 올리고 `extra`에서 뺀다 (`agent/shell_hooks.py` `_payload_fields`). `extra.parent_session_id`는 없다.
- 상태가 바뀔 때만 `since`를 갱신한다. 모든 이벤트에서 `seen = now`.
- 자식(서브에이전트) 세션 자신의 이벤트: `subagent_start`로 알려진 `childId`의 이벤트는 자식 파일을 만들지 않고, 부모 파일의 `subagents[childId].tool`만 갱신한다. 자식→부모 대응은 `<PERCH_HOME>/sessions/.children/<childId>` 파일(내용: 부모 id)로 기록한다.
- 쓰기는 원자적으로 한다: 같은 폴더의 임시 파일에 쓰고 rename. 동시 갱신은 `<파일>.lock`을 `create_new`로 잡아 직렬화한다 (최대 200ms 재시도 후에는 잠금 없이 진행, 2초 넘은 잠금 파일은 버려진 것으로 보고 지운다).

## 등록하는 Hermes hook
`hermes.rs` `EVENTS`: on_session_open, on_session_start, pre_llm_call, post_llm_call, pre_tool_call, post_tool_call, on_human_input_request, on_human_input_resolved, on_session_end, on_session_finalize, on_session_delete, subagent_start, subagent_stop. 목록이 바뀌면 사용자가 Connect를 다시 눌러야 새 hook이 등록된다. `post_llm_call`은 응답 끝이 질문인지(`asks`, `ask`) 알려 주는 데 쓴다.

## 선택 필드 `pane`
- 어댑터가 칸의 환경변수 `PERCH_PANE`을 볼 수 있으면 그 값을 `"pane": "<paneId>"`로 쓴다.
- 앱은 칸 id가 같고 칸의 `agent`가 세션의 `agent`와 같고 칸이 비어 있으면 그 칸에 정확히 연결한다 (`desk.rs` `relink_entries`).
- 볼 수 없으면 Hermes처럼 출력에서 세션 id를 찾아야 한다 (`sessions.rs` `Scan`, `desk.rs` `pane_attach`, `relink_entries`).

## 앱에 손댈 곳
| 할 일 | 위치 |
|---|---|
| 실행 명령 | `pty.rs` `command_for`, `launch` |
| resume 인자 | `desk.rs` `pane_create` (지금은 hermes만 허용), `pty.rs` `launch` |
| 제목, 토큰, 폴더 보강 | `sessions.rs` `query_db`, `enrich` (state.db 조회는 Hermes 전용) |
| 연결 버튼 | `hermes.rs` `connect`, `disconnect`, `status` |
| 승인 키 | `sessions.rs` `approve_key` (`desk.rs` `session_approve`가 호출, 지금은 `1`/Esc, Hermes TUI 기준) |
| 프런트 resume 분기 | `desk/src/lib/useTauriDesk.ts` `focusSession` |

## 현재 상태
- Hermes만 연결돼 있다.
- Hermes 칸은 기본으로 채팅 보기(`ChatView`)로 열리고, Perch가 Hermes gateway에 직접 붙는다 (`gateway.rs`, `desk/src/lib/chatSession.ts`). 터미널 화면은 "Hermes (TUI)"로 연다. 상태 파일은 두 방식 모두 Hermes의 shell hook이 같은 방식으로 쓰므로 패널은 그대로다. 다른 에이전트는 이 채팅 보기를 쓰지 않는다.
- OpenCode는 보류다 (사용자 결정, 2026-11-18).
- 칸에서 `opencode`를 실행하는 것은 지금도 된다. 패널에는 상태 없는 세션으로 나온다.
