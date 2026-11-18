# Hermes 네이티브 채팅 칸 설계

날짜: 2026-11-18 · 브랜치: `feat/hermes-chat-pane` (기준: `origin/fix/clipboard-folders-archive`)

## 왜

Hermes 칸은 지금 PTY에서 `hermes --tui`를 띄운 터미널이다. 고정폭 글꼴, 터미널 줄바꿈, 클릭 안 되는 링크 때문에 긴 대화를 읽기 어렵다. Hermes 데스크톱 앱처럼 gateway에 직접 붙어 대화를 React로 그리면 읽기 쉬워진다.

## 목표

- Hermes 칸의 기본 보기를 채팅으로 한다. 새 세션도, 사이드바에서 여는 기존 세션도 채팅으로 열린다.
- 채팅 보기: 보통 글꼴 마크다운, 코드 블록, 클릭되는 링크, 도구 실행 요약, 스트리밍 응답.
- 입력창: Enter 전송, Shift+Enter 줄바꿈, 한글 IME 정상, 텍스트와 이미지 붙여넣기.
- 승인과 질문 요청을 칸 안의 버튼으로 받는다. 사이드바의 승인 버튼도 그대로 동작한다.
- 기존 세션 resume 시 이전 대화가 보인다.
- 사이드바 상태(작업 중 / 승인 대기 / 완료), 폴더 그룹, 보관, 토큰 사용량이 지금처럼 동작한다.
- TUI 터미널 칸은 남는다. 새 세션 메뉴에서 고를 수 있다.

## 하지 않는 것

- 한 칸 안에서 채팅과 TUI를 오가는 전환. 칸은 만들 때 보기가 정해진다.
- 구문 강조, 수식, mermaid. 코드 블록은 고정폭 글꼴과 복사 버튼까지만.
- 슬래시 명령 자동완성, 모델 선택, 세션 선택 화면, 음성, 서브에이전트 조작. 슬래시 명령이 필요하면 TUI 칸을 쓴다.
- OpenCode와 Shell 칸 변경.
- Hermes 코드 수정.

## 실패로 보는 것

- 기존 TUI 칸이나 사이드바 동작이 깨지는 것.
- 한글 조합 중 Enter가 메시지를 보내버리는 것.
- 승인 요청이 화면에 안 보여서 에이전트가 멈춰 있는 것.

## 제약과 확인된 사실

- 오프라인 환경. 새 npm 패키지와 새 cargo crate는 쓰지 않는다. cargo 캐시에 WebSocket crate가 없다.
- `hermes gateway attach --json --start`는 `{url, protocols, ...}`를 준다. 예: `url = ws://127.0.0.1:9120/api/ws`, `protocols = ["hermes-gateway-v1", "hermes-gateway-ticket.<일회용>"]`. ticket은 30초 뒤 만료, 한 번만 쓸 수 있다. 로그에 남기지 않는다.
- **gateway는 `Origin` 헤더가 있는 접속을 403으로 거부한다**(2026-11-18 실측: `http://localhost:5173`, `http://tauri.localhost`, `tauri://localhost` 모두 403, Origin 없으면 성공). webview의 `WebSocket`은 Origin을 뺄 수 없으므로 webview에서 직접 붙을 수 없다.
- 접속하면 서버가 먼저 `gateway.ready` 이벤트를 보낸다. 프레임은 줄 단위 JSON-RPC 2.0.
- 이 gateway는 canonical(`hermes-gateway-v1`) wire다. 메서드: `runtime.describe`, `session.create`, `session.resume`, `prompt.submit`, `session.interrupt`, `approval.respond`, `clarify.respond`, `session.events.since`. 정의는 `D:\hermes-cli\app\tui_gateway\contracts\canonical*.py`, 생성된 TS 타입은 `apps/shared/src/gateway-contract.generated.ts`의 `CanonicalRpcMethods`.
- 승인과 질문은 서버 요청이 아니라 `approval.request` / `clarify.request` 이벤트로 온다. 답은 `approval.respond {session_id, execution_generation, prompt_id, choice}` / `clarify.respond {session_id, execution_generation, prompt_id, answer}`. resume 스냅샷의 `prompts`에 아직 열려 있는 요청이 들어 있다. (`client.capabilities {server_requests: true}`는 legacy 경로용으로 보인다. 1단계에서 필요 여부를 실제로 확인한다.)
- 이미지 첨부는 `prompt.submit`의 `attachments: [{path, mime}]`. 디스크의 파일 경로다.
- Hermes 데스크톱 앱의 마크다운은 streamdown + shiki로, Perch에 없고 무겁다.
- 미확인: gateway로 만든 세션에서도 Perch shell hook이 `~/.perch/sessions/*.json`을 쓰는가. hook은 에이전트 프로세스(gateway owner)에서 돌기 때문에 쓸 것으로 예상한다. 1단계에서 확인한다.

## 접근 방식

1. **webview에서 WebSocket 직접 연결.** 코드가 가장 적다. gateway가 Origin을 거부해서 불가능.
2. **Rust가 소켓을 갖고 줄을 그대로 중계, 프로토콜은 TypeScript.** (선택) Rust는 attach 실행, 접속, 줄 주고받기만 한다. JSON-RPC, 세션, 이벤트 해석은 프런트의 TS 모듈이 하고 vitest로 검증한다. WebSocket crate가 없으므로 `std::net::TcpStream` 위에 loopback 전용 최소 클라이언트를 직접 쓴다(핸드셰이크, 텍스트 프레임, 마스킹, ping/pong, 분할 프레임, close. TLS와 압축 없음). 150줄 안팎.
3. **Rust가 프로토콜까지 처리.** 세션 상태를 Rust가 직접 알 수 있지만, 이벤트 타입을 Rust와 TS 양쪽에 두 번 정의해야 하고 Hermes 버전이 바뀔 때 고칠 곳이 늘어난다.
4. **Node sidecar 프로세스.** Hermes의 `apps/shared` 클라이언트를 그대로 쓸 수 있지만, 배포물에 Node 런타임과 프로세스 관리가 더해진다.

2번을 고른 이유: 새 의존성이 없고, Rust 쪽이 작고 안 변하며, 바뀌기 쉬운 프로토콜 코드가 테스트하기 쉬운 TS 한 곳에 모인다.

## 설계

### 칸 모델

`AgentKind`는 그대로 둔다(`hermes | opencode | shell`). 칸에 `view: "chat" | "tui"` 필드를 더한다(`PaneInfo.view`, 프런트 `Pane.view`). Hermes가 아닌 칸은 항상 `tui`.

이유: 세션 파일, 사이드바 그룹, 사용량, `relink_entries`가 모두 `agent == "hermes"`로 맞춰져 있다. 새 agent 종류를 만들면 이 모두를 고쳐야 한다.

- `pane_create(agent, cwd, resume, view)`: `view`가 없으면 Hermes는 `chat`.
- 새 세션 메뉴의 Agent 목록: `Hermes`(채팅), `Hermes (TUI)`, `OpenCode`, `Shell`. 고른 값은 기존 `NewPaneDefaults`에 `view`로 저장된다.
- 사이드바에서 칸이 없는 Hermes 세션을 열면 `NewPaneDefaults`의 Hermes 보기(기본 chat)로 열린다.
- `TerminalView`가 `pane.view === "chat"`이면 `ChatView`를, 아니면 지금처럼 `PtyTerminalView`를 그린다. 브라우저 mock 모드에서는 지금처럼 `MockTerminalView`.

### Rust: `gateway.rs` (새 파일)

chat 칸 하나에 연결 하나.

- `chat_connect(pane_id, on_line: Channel)`: `hermes gateway attach --json --start`를 실행(창 없이, `hermes::exe()` 사용)해 url과 protocols를 얻는다. `TcpStream`으로 접속하고 WebSocket 핸드셰이크를 한다(`Origin` 헤더 없음, `Sec-WebSocket-Protocol`에 protocols). 읽기 스레드가 텍스트 메시지를 줄 단위로 나눠 `on_line`으로 보낸다. 연결이 끊기면 `{"perch":"closed","reason":...}` 한 줄을 보내고 끝난다. 이미 연결이 있으면 먼저 닫는다.
- `chat_send(pane_id, line)`: 텍스트 프레임 하나로 보낸다.
- `chat_close(pane_id)`: 닫는다. 칸이 닫히거나 창이 닫힐 때도 닫힌다.
- `chat_save_image(bytes, mime) -> path`: 붙여넣은 이미지를 `~/.perch/attachments/<난수>.<확장자>`에 저장하고 경로를 돌려준다. png, jpeg, gif, webp만. 20MB 제한.
- `pane_set_session(pane_id, session_id)`: chat 칸이 만든 세션 id를 칸에 기록한다(기존 `Desk::set_session` 사용).
- chat 칸은 PTY를 띄우지 않는다. `pane_attach`의 "연결 안 된 Hermes 칸은 한 번에 하나" gate와 배너 스캔도 chat 칸에는 적용하지 않는다. `relink_entries`의 추측 단계(시간순 매칭)에서 chat 칸은 제외한다. chat 칸은 세션 id를 직접 알기 때문이다.
- 프레임 인코딩과 디코딩, 핸드셰이크 요청 생성은 순수 함수로 두고 `cargo test --lib`로 검증한다.

### TypeScript: `lib/gateway.ts` (새 파일)

Rust 중계 위의 JSON-RPC 클라이언트. 전송 계층은 `{send(line), onLine(cb)}` 인터페이스로 받아서 vitest에서 가짜로 바꿀 수 있게 한다.

- `request(method, params)`: id를 붙여 보내고 응답을 Promise로 준다. 오류 응답은 reject.
- `onEvent(cb)`: `method == "event"` 알림의 `params`(`type`, `payload`, `session_id`, `seq`, `execution_generation`)를 넘긴다.
- 필요한 타입만 `lib/gatewayTypes.ts`에 직접 적는다(Hermes의 생성 파일 7,600줄을 복사하지 않는다). 출처 파일 경로를 주석에 남긴다. MIT 고지는 README의 감사 표기에 더한다.

### TypeScript: `lib/chatSession.ts` (새 파일)

이벤트 스트림을 화면 상태로 바꾸는 순수 reducer와, 그것을 gateway에 연결하는 hook `useChatSession(paneId, cwd, resumeId)`.

- 상태: `messages`(사용자 / 어시스턴트 / 도구), 스트리밍 중인 텍스트, `running`, 열려 있는 `prompts`(승인, 질문), `executionGeneration`, 연결 상태(`connecting | ready | closed | error`).
- 시작: `chat_connect` → `gateway.ready` 대기 → resume id가 있으면 `session.resume`, 없으면 `session.create {source, cwd}` → `pane_set_session`. `source`는 `runtime.describe`의 `session_create.sources`에 `tui`가 있으면 `tui`, 없으면 `cli`.
- 이벤트: `message.start` / `message.delta` / `message.complete`, `tool.start` / `tool.complete`, `approval.request` / `approval.settled`, `clarify.request` / `clarify.settled`, `error`. 정확한 payload는 구현자가 `gateway-contract.generated.ts`와 `ui-tui/src/app/gatewayCanonicalEvents.ts`, `createGatewayEventHandler.ts`에서 확인한다.
- 동작: `send(text, attachments)` → `prompt.submit`. `stop()` → `session.interrupt`. `answerApproval(promptId, choice)`, `answerClarify(promptId, answer)`.
- 끊김: 연결이 닫히면 상태를 `closed`로 바꾸고 "다시 연결" 버튼을 보인다. 버튼은 `chat_connect` 후 `session.resume`으로 스냅샷을 다시 받는다. 자동 재연결은 한 번만 시도한다(gateway가 idle로 꺼진 경우 `--start`가 다시 띄운다).
- reducer는 vitest로 검증한다(기록해 둔 이벤트 순서 → 기대 상태).

### 화면: `components/ChatView.tsx`, `ChatMessage.tsx`, `ChatComposer.tsx`, `lib/markdown.tsx` (새 파일)

```
┌ 칸 헤더(기존) ────────────────────────────┐
│  사용자 메시지 (오른쪽 정렬 말풍선)          │
│  어시스턴트: 마크다운 본문                   │
│   ▸ terminal · npm test        ✓ 2.1s     │  ← 도구 한 줄 요약, 누르면 펼침
│  ┌ 승인 필요 ─────────────────────────┐    │
│  │ rm -r build/                       │    │
│  │ [허용] [세션 동안 허용] [거부]       │    │  ← 서버가 준 choices 그대로
│  └────────────────────────────────────┘    │
├───────────────────────────────────────────┤
│ [이미지 썸네일 ×]                           │
│ 메시지 입력…                    [전송/중지] │
└ 칸 푸터(기존) ────────────────────────────┘
```

- 마크다운(`lib/markdown.tsx`): 직접 쓴 작은 렌더러. 문자열을 React 요소로 만든다(`dangerouslySetInnerHTML` 없음). 지원: 제목, 문단, 굵게, 기울임, 인라인 코드, 코드 블록(언어 표시, 복사 버튼), 순서 있는 목록과 없는 목록(중첩), 인용, 가로줄, 링크, 맨 URL 자동 링크, 표. 스트리밍 중 닫히지 않은 코드 블록은 열린 채로 그린다. 링크는 기존 `openUrl`(http/https만)로 연다. vitest로 검증한다.
- 도구: `도구 이름 · 인자 요약 · 상태(진행 중 / 완료 / 실패) · 걸린 시간` 한 줄. 누르면 인자와 결과 앞부분을 펼친다.
- 스크롤: 맨 아래에 있을 때만 새 내용을 따라 내려간다. 위로 올려 읽는 중이면 그대로 둔다.
- 입력창: `<textarea>`, 내용에 맞춰 높이가 늘어난다(최대 8줄). Enter 전송, Shift+Enter 줄바꿈. `event.nativeEvent.isComposing`이거나 `keyCode === 229`이면 Enter를 무시한다(한글 IME). 텍스트 붙여넣기는 브라우저 기본 동작. 클립보드에 이미지가 있으면 `chat_save_image`로 저장하고 썸네일을 보인다. 전송 시 `attachments`로 보낸다. 실행 중에는 전송 버튼이 중지 버튼이 된다. 실행 중 입력한 메시지는 `prompt.submit`에 그대로 보낸다(대기열 처리는 gateway가 한다).
- 칸에 포커스가 오면 입력창에 포커스를 준다.
- 스타일은 기존 `src/styles`의 변수와 글꼴을 쓴다. 새 UI 문자열은 기존처럼 한국어.

### 사이드바 연동

- 상태, 제목, 토큰, 폴더는 지금처럼 shell hook 파일과 `state.db`에서 읽는다. chat 칸은 `pane_set_session`으로 세션에 연결된다.
- 승인: `session_approve`가 chat 칸이면 PTY에 키를 쓰는 대신 `desk://chat-approve {paneId, allow}` 이벤트를 보낸다. `ChatView`가 받아서 열려 있는 승인에 `approval.respond`를 보낸다. `allow`는 서버 choices 중 한 번 허용에 해당하는 값, 거부는 거부에 해당하는 값(구현자가 `ui-tui/src/app/useApprovalAnswers.ts`에서 값 확인).
- 중지: `useTauriDesk.stop`이 chat 칸이면 `\x03` 대신 `desk://chat-stop {paneId}`를 보낸다.
- 1단계에서 hook이 gateway 세션에 대해 파일을 쓰지 않는다고 확인되면, 5단계에서 `ChatView`가 상태를 Rust에 알려 세션 목록에 합치는 방식으로 바꾼다. 그 경우 이 문서를 먼저 고친다.

## 세부 결정 (작성자 판단, 사용자가 바꿀 수 있음)

- **세션 id.** `session.create` / `session.resume` 결과에는 `session_id`(살아 있는 핸들)와 `stored_session_id`(저장된 id)가 둘 다 있다. `pane_set_session`, 사이드바 연결, 다음 resume에는 `stored_session_id`를 쓴다. RPC의 `session_id` 인자에는 결과의 `session_id`를 쓴다. 1단계에서 hook 파일과 `state.db`의 id가 `stored_session_id`와 같은지 확인해 기록한다. 다르면 여기를 고친다.
- **칸을 닫을 때**(사용자 결정, 2026-11-18). 소켓만 닫는다. 실행 중인 작업은 gateway에서 계속 돈다. 사이드바에는 hook 파일 기준으로 "작업 중"으로 남고, 눌러서 다시 열면 `session.resume`으로 이어서 보인다. 칸이 없는 동안 온 승인 요청은 세션을 다시 열면 스냅샷의 `prompts`로 복원된다. 창을 닫을 때와 앱을 끌 때도 같다.
- **ChatView가 사라졌다 다시 생길 때**(webview 새로고침, 칸 배치 변경). 대화 상태는 React 안에만 둔다. 다시 생기면 `chat_connect` → `session.resume`으로 스냅샷을 받아 다시 만든다. Rust는 듣는 쪽이 없으면 줄을 버린다(버퍼 없음). 스트리밍 중이던 응답은 스냅샷과 이후 이벤트로 이어진다.
- **hook이 gateway 세션에 대해 파일을 쓰지 않을 때.** 1단계는 이후 단계의 관문이다. 안 쓰는 것으로 확인되면 메인 세션이 이 문서의 "사이드바 연동"을 고치고 사용자에게 알린 뒤 2단계로 간다. 대체 경로: `ChatView`가 상태(`running`, 열린 요청, 제목)를 `chat_report_state` 명령으로 Rust에 알리고, `sessions.rs`가 hook 파일에서 읽은 목록에 합친다. 토큰은 지금처럼 `state.db`에서 읽는다.
- **저장된 설정.** `NewPaneDefaults`에 `view`가 없으면 Hermes는 `chat`. 칸 목록은 지금도 재시작 때 복원되지 않으므로 옮길 것이 없다.
- **한 세션에 칸 하나.** 사이드바에서 이미 칸이 있는 세션을 누르면 지금처럼 그 칸에 포커스한다. 같은 세션을 두 칸으로 여는 길은 만들지 않는다.
- **연결 수.** chat 칸마다 연결 하나. `hermes gateway attach`는 url과 ticket을 찍고 끝나는 짧은 프로세스다. gateway 자체는 프로필당 하나로 공유되고 idle이면 스스로 꺼진다. Perch가 따로 정리하지 않는다(설정 메뉴의 기존 gateway 중지 버튼은 그대로).

## 2026-11-18 실측 (실제 gateway에 한 턴 기록)

- `session.create {request_id, source: "tui", cwd}` 성공. `session_id`와 `stored_session_id`가 같은 값(`local-<hex 64>`)이었다.
- 세션을 만들자마자 hook이 `~/.perch/sessions/hermes-<id>.json`을 썼다. 사이드바 대체 경로(`chat_report_state`)는 필요 없다.
- `prompt.submit`에는 `submission_id`(또는 `input_id`)가 필수다. 없으면 `4001 invalid_params`.
- `client.capabilities` 없이 한 턴이 끝까지 돌았다. 승인 요청에도 필요 없는지는 4단계에서 확인한다.
- 한 턴의 이벤트: `message.start`, `thinking.delta`, `tool.generating`, `tool.start`, `tool.complete`, `message.delta`(`text`가 null일 수 있음), `session.usage`, `session.info`, `agent.step`, `sessions.changed`, `platforms.changed`, `message.complete`.
- 기록 파일을 `desk/src/lib/__fixtures__/turn.jsonl`로 넣어 reducer 테스트에 쓴다.
- **이미지 첨부(3단계에서 수정).** `prompt.submit`의 첨부 경로는 gateway의 이미지 staging 폴더 바로 아래 파일이어야 한다(`gateway/session_ingress_media.py::admit_attachments`). 다른 폴더의 파일은 `4001`. 그래서 Rust `chat_save_image`와 `~/.perch/attachments`는 쓰지 않고, gateway RPC `image.attach_bytes {session_id, filename, content_base64}` → `{path, mime}`로 올린 뒤 그 경로를 첨부한다. 위 "Rust: gateway.rs"의 `chat_save_image` 항목은 이것으로 대체된다.
- **resume 기록 형태.** `session.resume`의 `messages`는 모델 API 원본 형태다: user/assistant는 `content`, 도구 호출은 assistant의 `tool_calls[].function`, 도구 결과는 `role: "tool"` + `tool_name` + `tool_call_id` + `content`.

## 단계

각 단계는 Sonnet subagent 하나(병렬 표시가 있으면 둘)가 끝낼 크기. 단계마다 `npx vitest run`, `npx tsc --noEmit -p .`, `cargo test --lib`, 그리고 `npm run tauri dev` 실제 확인.

1. **최소 동작.** (병렬 둘: Rust / TS) `gateway.rs` 중계와 명령 등록, `view` 필드. `lib/gateway.ts`, 최소 `chatSession`, 꾸미지 않은 `ChatView`(입력 한 줄, 스트리밍 텍스트 그대로). 완료 기준: 새 Hermes 칸에서 메시지 하나를 보내면 응답이 스트리밍으로 보인다. 이때 hook 파일 생성 여부와 `client.capabilities` 필요 여부를 확인해 기록한다.
2. **대화 그리기.** 마크다운 렌더러와 테스트, 메시지 목록, 도구 요약, 스크롤, resume 시 이전 대화.
3. **입력창.** 높이 조절, Enter / Shift+Enter, IME, 중지, 이미지 붙여넣기(`chat_save_image`).
4. **승인과 질문.** 칸 안 버튼, resume 시 열려 있던 요청 복원, 사이드바 승인과 중지 연결.
5. **사이드바와 메뉴.** 새 세션 메뉴의 `Hermes` / `Hermes (TUI)`, 사이드바 resume의 기본 보기, 상태와 토큰 확인, 필요하면 hook 대체 경로.
6. **끊김 처리와 마무리.** 재연결, 오류 표시, README와 handoff 문서 갱신.

## 구현자에게 맡기는 것

- 이벤트 payload의 정확한 필드와 reducer의 세부 구조.
- 마크다운 파서 내부 구조, CSS 세부.
- 도구 인자 요약 문구.
- Rust 스레드 구성과 오류 메시지 문구.
