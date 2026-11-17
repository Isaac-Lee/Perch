# 에이전트 어댑터 붙이기

## 계약
계약은 상태 파일 하나다. 앱은 이 파일만 읽는다.

| 항목 | 내용 |
|---|---|
| 위치 | `<PERCH_HOME>/sessions/<agent>-<sessionId>.json` |
| 필드, 이벤트→상태 규칙 | `docs/superpowers/plans/2026-11-17-perch-phase3-hermes.md` 2.1절 |
| 쓰기 | 임시 파일에 쓰고 rename (원자적) |
| 오류 | 어떤 오류도 에이전트로 던지지 않는다 |

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
| 승인 키 | `sessions.rs` `approve_key` (`desk.rs` `session_approve`가 호출, 지금은 `1`/`4`) |
| 프런트 resume 분기 | `desk/src/lib/useTauriDesk.ts` `focusSession` |

## 현재 상태
- Hermes만 연결돼 있다.
- OpenCode는 보류다 (사용자 결정, 2026-11-18).
- 칸에서 `opencode`를 실행하는 것은 지금도 된다. 패널에는 상태 없는 세션으로 나온다.
