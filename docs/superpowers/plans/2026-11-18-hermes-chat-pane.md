# Hermes 네이티브 채팅 칸 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hermes 칸을 기본으로 gateway에 붙는 React 채팅 보기로 열고, TUI 칸은 선택지로 남긴다.

**Architecture:** Rust(`gateway.rs`)가 `hermes gateway attach`로 받은 주소에 `TcpStream`으로 WebSocket 접속을 하고 줄을 그대로 중계한다. JSON-RPC와 이벤트 해석은 TypeScript(`lib/gateway.ts`, `lib/chatSession.ts`)가 하고, `ChatView`가 그린다. 사이드바 상태는 지금처럼 shell hook 파일에서 온다.

**Tech Stack:** Tauri 2, Rust(std만), React 19, TypeScript, vitest. 새 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-11-18-hermes-chat-pane-design.md`

## Global Constraints

- 작업 폴더는 worktree `D:\ysl\Perch-chat`(브랜치 `feat/hermes-chat-pane`). `D:\ysl\Perch`는 건드리지 않는다.
- `D:\hermes-cli` 아래는 읽기만 한다. 수정 금지.
- 새 npm 패키지와 새 cargo crate 금지. `package.json`, `Cargo.toml`의 의존성은 그대로.
- gateway 접속 요청에 `Origin` 헤더를 넣지 않는다(있으면 403).
- ticket(`hermes-gateway-ticket.*` protocol 값)은 로그, 오류 메시지, 이벤트에 남기지 않는다.
- 새 UI 문자열은 한국어. 코드 주석과 커밋 메시지는 영어(기존 관례).
- 마크다운은 React 요소로만 만든다. `dangerouslySetInnerHTML` 금지. 링크는 `openUrl`(http/https만)로 연다.
- 검증 명령(`desk` 폴더): `npx vitest run`, `npx tsc --noEmit -p .`. `desk/src-tauri`: `cargo test --lib`. cargo가 PATH에 없으면 `export PATH="$HOME/.cargo/bin:$PATH"`.
- 커밋 메시지 끝: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- 기존 TUI 칸, OpenCode, Shell 칸의 동작과 기존 테스트는 그대로 통과해야 한다.

## Review Focus

1. 한글 조합 중 Enter: 조합만 확정되고 메시지는 전송되지 않아야 한다. (Task 5 테스트)
2. 스트리밍 중 닫히지 않은 코드 블록(```` ``` ```` 하나만 온 상태): 화면이 깨지지 않고 열린 코드 블록으로 보여야 한다. (Task 3 테스트)
3. `message.delta`의 `text`가 null이거나 빈 문자열: 무시하고 "null" 글자가 붙지 않아야 한다. (Task 2 테스트)
4. WebSocket 프레임이 TCP 읽기 경계에서 잘리거나 한 읽기에 여러 프레임이 오는 경우, 그리고 한글 3바이트 문자가 분할 프레임 사이에서 잘리는 경우: 줄이 온전해야 한다. (Task 1 테스트)
5. gateway가 꺼져 있거나 `hermes` 실행 파일이 없을 때 새 chat 칸: 빈 화면이 아니라 오류 문구와 "다시 연결" 버튼이 보여야 한다. (Task 2 reducer 테스트, Task 7 화면)

## 파일 구조

| 파일 | 역할 |
|---|---|
| `desk/src-tauri/src/gateway.rs` (새) | attach 실행, WebSocket 최소 클라이언트, `chat_*` 명령, 이미지 저장 |
| `desk/src-tauri/src/desk.rs` | `PaneInfo.view`, `pane_create`의 `view`, `pane_set_session`, chat 칸은 PTY와 추측 연결에서 제외, 승인과 중지 전달 |
| `desk/src-tauri/src/lib.rs` | 모듈과 명령 등록 |
| `desk/src/lib/gateway.ts` (새) | JSON-RPC 클라이언트(전송 계층 주입) |
| `desk/src/lib/gatewayTypes.ts` (새) | 쓰는 wire 타입만 |
| `desk/src/lib/chatSession.ts` (새) | reducer와 `useChatSession` hook |
| `desk/src/lib/markdown.tsx` (새) | 마크다운 → React 요소 |
| `desk/src/components/ChatView.tsx`, `ChatMessage.tsx`, `ChatComposer.tsx`, `ChatPrompt.tsx` (새) | 화면 |
| `desk/src/styles/chat.css` (새) | 채팅 스타일(`tokens.css` 변수 사용) |
| `desk/src/lib/backend.ts`, `types.ts`, `uiSettings.ts`, `useTauriDesk.ts`, `components/TerminalView.tsx`, `Pane.tsx`, `NewPaneMenu.tsx`, `App.tsx` | `view` 전달과 메뉴 |

---

## 단계 1: 최소 동작 (Task 1과 Task 2는 병렬)

### Task 1: Rust gateway 중계와 칸의 `view`

**Files:**
- Create: `desk/src-tauri/src/gateway.rs`
- Modify: `desk/src-tauri/src/desk.rs`, `desk/src-tauri/src/lib.rs`
- Test: 각 파일의 `#[cfg(test)] mod tests`

**Interfaces — Produces (Tauri 명령, 프런트가 그대로 부른다):**
- `pane_create(agent: String, cwd: String, resume: Option<String>, view: Option<String>) -> Result<String, String>`: `view`는 `"chat"` 또는 `"tui"`. 없으면 `agent == "hermes"`일 때 `"chat"`, 아니면 `"tui"`. hermes가 아닌데 `"chat"`이면 오류.
- `PaneInfo`에 `view: String` 추가(JSON 키 `view`).
- `chat_connect(id: String, on_line: Channel<String>) -> Result<(), String>`: 받은 JSON 줄마다 `on_line.send(line)`. 연결이 끝나면 마지막으로 `{"perch":"closed","reason":"<짧은 이유>"}` 한 줄을 보낸다. 같은 칸에 이미 연결이 있으면 먼저 닫는다. `id`가 없는 칸이거나 chat 칸이 아니면 오류.
- `chat_send(id: String, line: String) -> Result<(), String>`: 연결이 없으면 오류 `"연결되지 않았습니다"`.
- `chat_close(id: String) -> Result<(), String>`
- `pane_set_session(id: String, session_id: String) -> Result<(), String>`: 칸의 `session_id`를 덮어쓰고 `desk://panes` 스냅샷을 다시 보낸다.

**gateway.rs 안의 순수 함수(테스트 대상):**
- `fn parse_attach(json: &str) -> Result<Attach, String>` — `Attach { host: String, port: u16, path: String, protocols: Vec<String> }`. 입력 예: `{"url":"ws://127.0.0.1:9120/api/ws","protocols":["hermes-gateway-v1","hermes-gateway-ticket.abc"],"state":"ready"}`. `ws://`가 아니거나 `protocols`가 비면 오류. 오류 문구에 입력 JSON을 넣지 않는다.
- `fn handshake_request(a: &Attach, key: &str) -> String` — `GET {path} HTTP/1.1`, `Host: {host}:{port}`, `Upgrade: websocket`, `Connection: Upgrade`, `Sec-WebSocket-Key: {key}`, `Sec-WebSocket-Version: 13`, `Sec-WebSocket-Protocol: {protocols를 ", "로 연결}`, 빈 줄. `Origin` 없음.
- `fn encode_frame(opcode: u8, payload: &[u8], mask: [u8; 4]) -> Vec<u8>` — FIN=1, MASK=1, 길이 7비트 / 16비트(126) / 64비트(127).
- `struct Decoder` + `fn feed(&mut self, bytes: &[u8]) -> Vec<Msg>` — `enum Msg { Text(String), Ping(Vec<u8>), Close }`. 부분 입력을 버퍼에 두고, continuation 프레임을 이어 붙여 FIN에서 `Text` 하나로 내고, UTF-8 변환은 메시지가 완성된 뒤에 한다(lossy). Pong과 Binary는 무시.

**동작:**
- attach: `crate::hermes::exe()`로 찾은 실행 파일에 `gateway attach --json --start --timeout 60`. Windows에서는 `CREATE_NO_WINDOW`(0x0800_0000). stdin은 null. 종료 코드가 0이 아니면 stderr 끝 300자를 오류로(여기에 ticket은 없다). `tauri::async_runtime::spawn_blocking`에서 실행.
- 접속: `TcpStream::connect`, 핸드셰이크 전송, 응답 헤더를 `\r\n\r\n`까지 읽어 `HTTP/1.1 101`로 시작하는지 확인(아니면 상태 줄을 오류로). `Sec-WebSocket-Accept` 검증은 생략. 헤더 뒤에 딸려 온 바이트는 `Decoder`에 넘긴다. `Sec-WebSocket-Key`는 고정 문자열 `"cGVyY2gtY2hhdC1wYW5lIQ=="`.
- 읽기 스레드: `Text`는 `\n`으로 나눠 빈 줄을 빼고 `on_line`으로. `Ping`은 같은 payload의 Pong(opcode 0xA)으로 답한다. `Close`나 읽기 오류면 closed 줄을 보내고 끝.
- 쓰기: `stream.try_clone()`을 `Mutex`에 넣어 `chat_send`와 Pong이 공유. 마스크 키는 `SystemTime` 나노초와 카운터로 만든다(주석: `// ponytail: loopback only, mask is not a security boundary`).
- 상태: `pub struct Chats(Mutex<HashMap<String, Conn>>)`를 `lib.rs`에서 `.manage`. `Conn`의 `Drop`이 `stream.shutdown(Both)`.
- 칸이 닫히면(`pane_close`, 창 `close_window`) 그 칸의 연결도 닫는다. `Desk::remove`가 지운 칸 id를 돌려주도록 바꾸거나 호출하는 쪽에서 닫는다.
- `desk.rs`: chat 칸에 `pane_attach`가 오면 오류 `"채팅 칸에는 터미널이 없습니다"`. `relink_entries`의 시간순 추측 단계(`order`)에서 `view == "chat"`인 칸을 뺀다. `session_approve`와 `pane_write`는 이 Task에서 바꾸지 않는다.

- [ ] **Step 1: 실패하는 테스트 작성** (`gateway.rs`)

```rust
#[test] fn attach_parses() {
    let a = parse_attach(r#"{"url":"ws://127.0.0.1:9120/api/ws","protocols":["hermes-gateway-v1","hermes-gateway-ticket.abc"]}"#).unwrap();
    assert_eq!((a.host.as_str(), a.port, a.path.as_str()), ("127.0.0.1", 9120, "/api/ws"));
    assert_eq!(a.protocols.len(), 2);
    assert!(parse_attach(r#"{"url":"http://x/","protocols":["a"]}"#).is_err());
    assert!(parse_attach(r#"{"url":"ws://127.0.0.1:1/api/ws","protocols":[]}"#).is_err());
    let e = parse_attach(r#"{"url":"wss://h/","protocols":["hermes-gateway-ticket.SECRET"]}"#).unwrap_err();
    assert!(!e.contains("SECRET"));
}
#[test] fn handshake_has_protocols_and_no_origin() {
    let a = parse_attach(r#"{"url":"ws://127.0.0.1:9120/api/ws","protocols":["p1","p2"]}"#).unwrap();
    let r = handshake_request(&a, "k");
    assert!(r.starts_with("GET /api/ws HTTP/1.1\r\n") && r.ends_with("\r\n\r\n"));
    assert!(r.contains("Host: 127.0.0.1:9120\r\n") && r.contains("Sec-WebSocket-Protocol: p1, p2\r\n"));
    assert!(!r.to_lowercase().contains("origin"));
}
#[test] fn encode_lengths() {
    let m = [1, 2, 3, 4];
    let f = encode_frame(1, b"hi", m);
    assert_eq!(&f[..6], &[0x81, 0x82, 1, 2, 3, 4]);
    assert_eq!(&f[6..], &[b'h' ^ 1, b'i' ^ 2]);
    assert_eq!(encode_frame(1, &[0; 126], m)[1], 0x80 | 126);
    assert_eq!(encode_frame(1, &[0; 70000], m)[1], 0x80 | 127);
}
// server frames are unmasked
fn srv(fin: bool, op: u8, p: &[u8]) -> Vec<u8> { /* helper: build an unmasked frame, 7/16/64-bit length */ }
#[test] fn decode_split_across_reads_and_many_per_read() {
    let mut d = Decoder::default();
    let mut all = srv(true, 1, b"one");
    all.extend(srv(true, 1, b"two"));
    assert!(d.feed(&all[..3]).is_empty());
    assert_eq!(d.feed(&all[3..]), vec![Msg::Text("one".into()), Msg::Text("two".into())]);
}
#[test] fn decode_fragmented_utf8_and_control() {
    let mut d = Decoder::default();
    let s = "한글".as_bytes(); // 6 bytes; split inside the first character
    let mut b = srv(false, 1, &s[..2]);
    b.extend(srv(true, 9, b"p")); // ping between fragments
    b.extend(srv(true, 0, &s[2..]));
    b.extend(srv(true, 8, b""));
    assert_eq!(d.feed(&b), vec![Msg::Ping(b"p".to_vec()), Msg::Text("한글".into()), Msg::Close]);
}
#[test] fn decode_long_frame() {
    let mut d = Decoder::default();
    let p = vec![b'a'; 70000];
    assert_eq!(d.feed(&srv(true, 1, &p)), vec![Msg::Text(String::from_utf8(p).unwrap())]);
}
```

`desk.rs` 테스트 추가: `relink_skips_chat_panes` — `view == "chat"`이고 `session_id`가 None인 hermes 칸은 시간이 맞는 세션이 있어도 추측으로 연결되지 않는다(기존 `entry` 헬퍼에 `view` 인자를 더하거나 필드를 직접 바꾼다).

- [ ] **Step 2:** `cargo test --lib` → 새 테스트가 컴파일 오류로 실패하는지 확인.
- [ ] **Step 3:** 위 인터페이스대로 구현. `lib.rs`에 `mod gateway;`, `.manage(gateway::Chats::default())`, 명령 5개(`chat_connect`, `chat_send`, `chat_close`, `desk::pane_set_session`) 등록.
- [ ] **Step 4:** `cargo test --lib` 전부 통과, `cargo build` 경고 없음.
- [ ] **Step 5:** 커밋 `feat(desk): gateway relay and chat view flag for Hermes panes`.

### Task 2: TS JSON-RPC 클라이언트, 세션 reducer, 최소 ChatView

**Files:**
- Create: `desk/src/lib/gateway.ts`, `gatewayTypes.ts`, `chatSession.ts`, `desk/src/components/ChatView.tsx`, `desk/src/lib/__fixtures__/turn.jsonl`
- Modify: `desk/src/lib/backend.ts`, `types.ts`, `useTauriDesk.ts`, `desk/src/components/TerminalView.tsx`, `Pane.tsx`
- Test: `desk/src/lib/gateway.test.ts`, `chatSession.test.ts`

**Interfaces — Consumes:** Task 1의 명령(위 시그니처). Task 1이 끝나기 전이라도 그 이름과 인자로 `backend.ts` 래퍼를 쓴다.

**Interfaces — Produces:**

```ts
// backend.ts
export type PaneView = "chat" | "tui";
export const paneCreate = (agent: AgentKind, cwd: string, resume?: string, view?: PaneView) => invoke<string>("pane_create", { agent, cwd, resume, view });
export function chatConnect(id: string, onLine: (line: string) => void): Promise<void>; // Channel<string>
export const chatSend = (id: string, line: string) => invoke<void>("chat_send", { id, line });
export const chatClose = (id: string) => invoke<void>("chat_close", { id });
export const paneSetSession = (id: string, sessionId: string) => invoke<void>("pane_set_session", { id, sessionId });
// PaneInfo gains `view: PaneView`; types.ts Pane gains `view: PaneView`

// gateway.ts
export interface GatewayEvent { type: string; payload?: any; session_id?: string; seq?: number; execution_generation?: number }
export interface Rpc {
  handleLine(line: string): void;              // feed every line from the transport
  request<T = unknown>(method: string, params?: object): Promise<T>; // rejects with Error(message) on an error reply or on close
  onEvent(cb: (ev: GatewayEvent) => void): () => void;
  onClosed(cb: (reason: string) => void): () => void; // fired by the {"perch":"closed"} line
}
export function createRpc(send: (line: string) => void | Promise<void>): Rpc;

// chatSession.ts
export type ChatItem =
  | { kind: "user"; id: string; text: string; images?: string[] }
  | { kind: "assistant"; id: string; text: string; streaming: boolean }
  | { kind: "tool"; id: string; name: string; context: string; status: "running" | "done" | "error"; durationS?: number; result?: string }
  | { kind: "error"; id: string; text: string };
export interface ChatPrompt { kind: "approval" | "clarify"; promptId: string; executionGeneration: number; choices: string[]; command?: string; description?: string; question?: string }
export interface ChatState { conn: "connecting" | "ready" | "closed" | "error"; error?: string; sessionId: string | null; executionGeneration: number; running: boolean; items: ChatItem[]; prompts: ChatPrompt[] }
export const initialChat: ChatState;
export type ChatAction =
  | { t: "conn"; conn: ChatState["conn"]; error?: string }
  | { t: "snapshot"; snap: any }            // result of session.create / session.resume
  | { t: "userSent"; id: string; text: string; images?: string[] }
  | { t: "event"; ev: GatewayEvent };
export function chatReducer(s: ChatState, a: ChatAction): ChatState;
export function useChatSession(paneId: string, cwd: string, resumeId: string | null): {
  state: ChatState; send(text: string, attachments?: { path: string; mime: string }[]): void; stop(): void;
  answerApproval(promptId: string, choice: string): void; answerClarify(promptId: string, answer: string): void; reconnect(): void;
};
```

**정해진 값:**
- `request`의 id는 1부터 증가하는 숫자. 프레임: `{"jsonrpc":"2.0","id":n,"method":m,"params":p}`.
- 시작 순서(`useChatSession`): `chatConnect` → `gateway.ready` 이벤트 대기 → `resumeId`가 있으면 `session.resume {session_id: resumeId}`, 없으면 `session.create {request_id: crypto.randomUUID(), source: "tui", cwd}` → `snapshot` dispatch → `paneSetSession(paneId, snap.stored_session_id)`.
- `send`: `prompt.submit {session_id, text, submission_id: crypto.randomUUID(), attachments?}`. `submission_id`가 없으면 서버가 `4001`을 준다.
- `stop`: `session.interrupt {session_id, execution_generation}`.
- `answerApproval`: `approval.respond {session_id, execution_generation, prompt_id, choice}`. `answerClarify`: `clarify.respond {…, answer}`.
- unmount 시 `chatClose(paneId)`. React StrictMode의 이중 effect에서 연결이 두 번 남지 않게 한다.
- reducer 이벤트 처리(이 Task 범위): `message.start`(running=true), `message.delta`(`payload.text`가 문자열이고 비어 있지 않을 때만 마지막 streaming assistant 항목에 붙임, 없으면 새로 만듦), `message.complete`(`payload.text`로 본문 확정, streaming=false, running=false), `tool.start` / `tool.complete`(항목 추가와 갱신, `tool_id`로 짝), `error`(error 항목, running=false). 그 밖의 타입은 state를 그대로 돌려준다. 이벤트의 `execution_generation`이 숫자면 state에 반영.
- `snapshot`: `sessionId = snap.session_id`, `executionGeneration`, `running`, `items = []`(기록 변환은 Task 4), `prompts = []`(Task 6).
- fixture: `C:\Users\user\AppData\Local\Temp\claude\de7296c5e77ba5b8\fa950783-de9a-4430-a17e-55c050e14c99\scratchpad\turn.jsonl`을 `desk/src/lib/__fixtures__/turn.jsonl`로 복사한다. 각 줄은 `{"dir":"in"|"out","line":"<wire 줄>"}`. 실제 gateway에서 한 턴(도구 2번, 마지막 답 `- Ran \`echo perch\`.\n- Output: \`perch\``)을 기록한 것이다. payload 필드는 이 파일에서 확인한다.
- `ChatView`(최소): props `{ paneId: string; cwd: string; sessionId: string | null; focused: boolean }`. 항목을 `<pre>` 수준으로 나열하고 `<textarea>` 하나와 전송 버튼. 꾸미지 않는다. `conn`이 `error`/`closed`면 문구와 "다시 연결" 버튼.
- `TerminalView`: Tauri이고 `pane.view === "chat"`이면 `ChatView`, 아니면 기존대로. `Pane.tsx`가 `pane.view`, `pane.cwd`, `pane.sessionId`를 넘긴다. chat 칸의 `resumeId`는 **칸이 처음 그려질 때의** `pane.sessionId`다(`useTauriDesk`가 `i.sessionId ?? i.id`로 채우므로, 값이 칸 id와 같으면 null로 본다).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// gateway.test.ts
it("matches replies to requests and rejects errors", async () => {
  const sent: string[] = []; const rpc = createRpc((l) => { sent.push(l); });
  const a = rpc.request<{ ok: number }>("m1", { x: 1 }); const b = rpc.request("m2");
  expect(JSON.parse(sent[0])).toEqual({ jsonrpc: "2.0", id: 1, method: "m1", params: { x: 1 } });
  rpc.handleLine('{"jsonrpc":"2.0","id":2,"error":{"code":4001,"message":"invalid_params"}}');
  rpc.handleLine('{"jsonrpc":"2.0","id":1,"result":{"ok":1}}');
  await expect(a).resolves.toEqual({ ok: 1 }); await expect(b).rejects.toThrow("invalid_params");
});
it("delivers events, ignores garbage, fails pending on close", async () => {
  const rpc = createRpc(() => {}); const evs: GatewayEvent[] = []; rpc.onEvent((e) => evs.push(e));
  let closed = ""; rpc.onClosed((r) => { closed = r; });
  rpc.handleLine("not json");
  rpc.handleLine('{"jsonrpc":"2.0","method":"event","params":{"type":"message.delta","payload":{"text":"hi"},"session_id":"s"}}');
  expect(evs).toEqual([{ type: "message.delta", payload: { text: "hi" }, session_id: "s" }]);
  const p = rpc.request("x"); rpc.handleLine('{"perch":"closed","reason":"eof"}');
  await expect(p).rejects.toThrow(); expect(closed).toBe("eof");
});

// chatSession.test.ts
const ev = (type: string, payload: object = {}): ChatAction => ({ t: "event", ev: { type, payload } });
it("streams deltas into one assistant item and ignores null text", () => {
  let s = chatReducer(initialChat, ev("message.start"));
  for (const t of [null, "", "he", "llo"]) s = chatReducer(s, ev("message.delta", { text: t }));
  expect(s.running).toBe(true);
  expect(s.items).toEqual([expect.objectContaining({ kind: "assistant", text: "hello", streaming: true })]);
  s = chatReducer(s, ev("message.complete", { text: "hello!" }));
  expect(s.items[0]).toMatchObject({ text: "hello!", streaming: false }); expect(s.running).toBe(false);
});
it("pairs tool.start and tool.complete by tool_id", () => {
  let s = chatReducer(initialChat, ev("tool.start", { tool_id: "t1", name: "terminal", context: "echo perch" }));
  expect(s.items[0]).toMatchObject({ kind: "tool", name: "terminal", context: "echo perch", status: "running" });
  s = chatReducer(s, ev("tool.complete", { tool_id: "t1", name: "terminal", duration_s: 0.4 }));
  expect(s.items).toHaveLength(1); expect(s.items[0]).toMatchObject({ status: "done", durationS: 0.4 });
});
it("replays the recorded turn", () => {
  // read __fixtures__/turn.jsonl (node:fs), feed every "in" line that is an event through chatReducer
  // expect: last item is assistant with text "- Ran `echo perch`.\n- Output: `perch`", streaming false;
  //         two tool items (skills_list, terminal), both status "done"; running false
});
it("connection error is visible state", () => {
  const s = chatReducer(initialChat, { t: "conn", conn: "error", error: "hermes를 찾을 수 없습니다" });
  expect(s).toMatchObject({ conn: "error", error: "hermes를 찾을 수 없습니다" });
});
```

- [ ] **Step 2:** `npx vitest run src/lib/gateway.test.ts src/lib/chatSession.test.ts` → 실패 확인.
- [ ] **Step 3:** 구현. `gatewayTypes.ts` 맨 위 주석에 출처(`hermes-agent apps/shared/src/gateway-contract.generated.ts`, MIT)를 적는다.
- [ ] **Step 4:** `npx vitest run`과 `npx tsc --noEmit -p .` 통과.
- [ ] **Step 5:** 커밋 `feat(desk): gateway JSON-RPC client and minimal chat view`.

### 단계 1 검증 (메인 세션)

diff 검토 → 세 검증 명령 → `npm run tauri dev`에서: 새 Hermes 칸이 채팅으로 열리고, 메시지 하나에 응답이 스트리밍으로 보이고, 사이드바에 세션이 "작업 중" → 완료로 바뀌고 칸과 연결되는지, 칸을 닫아도 세션이 사이드바에 남는지, `Hermes` TUI 칸(`view: "tui"`로 직접 호출)이 그대로 뜨는지.

---

## 단계 2: 대화 그리기 (Task 3과 Task 4는 병렬)

### Task 3: 마크다운 렌더러

**Files:** Create `desk/src/lib/markdown.tsx`, `desk/src/lib/markdown.test.tsx`

**Interfaces — Produces:** `export function Markdown({ text, onLink }: { text: string; onLink: (url: string) => void }): JSX.Element` 와 테스트용 `export function parseBlocks(text: string): Block[]`.

```ts
export type Block =
  | { t: "p"; text: string } | { t: "h"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { t: "code"; lang: string; text: string; open: boolean }   // open: 닫는 ``` 가 아직 없음
  | { t: "list"; ordered: boolean; items: { text: string; children: Block[] }[] }
  | { t: "quote"; children: Block[] } | { t: "hr" }
  | { t: "table"; head: string[]; rows: string[][] };
```

인라인(블록의 `text` 안): `**굵게**`, `*기울임*` / `_기울임_`, `` `코드` ``, `[글](url)`, 맨 `http(s)://` URL. 링크는 `<a href={url} onClick={(e) => { e.preventDefault(); onLink(url); }}>`. `http://`와 `https://`가 아닌 url은 링크로 만들지 않고 글자 그대로 둔다. 코드 블록에는 언어 이름과 "복사" 버튼(`navigator.clipboard.writeText`). 테스트 환경에 DOM이 없으면 `react-dom/server`의 `renderToStaticMarkup`으로 검사한다.

- [ ] **Step 1: 실패하는 테스트**

```ts
it("blocks", () => {
  expect(parseBlocks("# T\n\npara one\nstill\n\n---\n")).toEqual([{ t: "h", level: 1, text: "T" }, { t: "p", text: "para one\nstill" }, { t: "hr" }]);
  expect(parseBlocks("```ts\nconst a = 1;\n```")).toEqual([{ t: "code", lang: "ts", text: "const a = 1;", open: false }]);
  expect(parseBlocks("```py\nprint(1)")).toEqual([{ t: "code", lang: "py", text: "print(1)", open: true }]); // streaming
  expect(parseBlocks("- a\n  - b\n- c")).toEqual([{ t: "list", ordered: false, items: [
    { text: "a", children: [{ t: "list", ordered: false, items: [{ text: "b", children: [] }] }] }, { text: "c", children: [] }] }]);
  expect(parseBlocks("1. x\n2. y")[0]).toMatchObject({ t: "list", ordered: true });
  expect(parseBlocks("| a | b |\n|---|---|\n| 1 | 2 |")).toEqual([{ t: "table", head: ["a", "b"], rows: [["1", "2"]] }]);
  expect(parseBlocks("> q")).toEqual([{ t: "quote", children: [{ t: "p", text: "q" }] }]);
});
it("inline and links", () => {
  const html = renderToStaticMarkup(<Markdown text={"**b** *i* `c` [x](https://a.b/c) https://d.e [bad](javascript:alert(1))"} onLink={() => {}} />);
  expect(html).toContain("<strong>b</strong>"); expect(html).toContain("<em>i</em>"); expect(html).toContain("<code>c</code>");
  expect(html).toContain('href="https://a.b/c"'); expect(html).toContain('href="https://d.e"');
  expect(html).not.toContain("javascript:");
});
it("does not interpret markdown inside code", () => {
  expect(renderToStaticMarkup(<Markdown text={"```\n**x** <b>\n```"} onLink={() => {}} />)).toContain("**x** &lt;b&gt;");
});
it("renders the Review Focus case: lone fence and empty text do not throw", () => {
  for (const t of ["```", "", "|", "- ", "**", "[x]("]) expect(() => renderToStaticMarkup(<Markdown text={t} onLink={() => {}} />)).not.toThrow();
});
```

- [ ] **Step 2:** 실패 확인. **Step 3:** 구현. **Step 4:** `npx vitest run`, `npx tsc --noEmit -p .`. **Step 5:** 커밋 `feat(desk): small markdown renderer for chat`.

### Task 4: 메시지 목록, 도구 요약, 스크롤, resume 기록

**Files:** Create `desk/src/components/ChatMessage.tsx`, `desk/src/styles/chat.css`. Modify `ChatView.tsx`, `chatSession.ts`, `chatSession.test.ts`, `desk/src/main.tsx`(css import).

**Interfaces — Consumes:** Task 3의 `Markdown`(Task 3과 병렬이므로 `ChatMessage`는 `import { Markdown } from "../lib/markdown"`만 쓰고, 그 파일은 만들지 않는다. 타입체크는 두 Task가 합쳐진 뒤 메인이 돌린다). `openUrl`(`backend.ts`).

**Interfaces — Produces:** `export function transcriptToItems(messages: any[]): ChatItem[]`(`chatSession.ts`). `ChatMessage({ item }: { item: ChatItem })`.

- `transcriptToItems`: `session.resume` 결과의 `messages`(`{role, text?, content?, name?, context?, tool_call_id?}`)를 항목으로. `role: "user"` → user, `"assistant"` → assistant(streaming false, 본문이 비면 건너뜀), `"tool"` → tool(status done, `name`, `context ?? ""`). 그 밖의 role은 건너뜀. `text`가 없고 `content`가 문자열이면 그것을 쓴다. `snapshot` 액션이 `items = transcriptToItems(snap.messages ?? [])`로 채운다. 정확한 필드는 `D:\hermes-cli\app\apps\shared\src\gateway-contract.generated.ts`의 `TranscriptMessage`와, `D:\hermes-cli\app\ui-tui\src\app\sessionResumeView.ts`에서 확인한다.
- 화면: user는 오른쪽 말풍선(줄바꿈 유지, 마크다운 해석 안 함), assistant는 `Markdown`, tool은 한 줄(`이름 · context · 상태 · 걸린 시간`)이고 누르면 `result` 앞 2,000자를 펼침, error는 붉은 줄. 스트리밍 중인 assistant 끝에는 깜빡이는 커서.
- 스크롤: 목록 맨 아래에서 40px 안에 있을 때만 새 내용에 맞춰 내려간다. 사용자가 보낸 직후에는 항상 맨 아래로.
- 스타일: `tokens.css` 변수와 본문 글꼴(고정폭 아님). 코드만 고정폭.

- [ ] **Step 1: 테스트** — `transcriptToItems`: user/assistant/tool/system 섞인 입력 → system과 빈 assistant는 빠지고 순서 유지. `snapshot` 액션이 `messages`를 항목으로 채움.
- [ ] **Step 2–4:** 실패 확인, 구현, `npx vitest run`.
- [ ] **Step 5:** 커밋 `feat(desk): chat transcript, tool rows and resume history`.

---

## 단계 3: 입력창

### Task 5: ChatComposer와 이미지 붙여넣기

**Files:** Create `desk/src/components/ChatComposer.tsx`, `desk/src/lib/composer.ts`, `composer.test.ts`. Modify `ChatView.tsx`, `chat.css`, `backend.ts`, `desk/src-tauri/src/gateway.rs`, `lib.rs`.

**Interfaces — Produces:**
- Rust `chat_save_image(bytes: Vec<u8>, mime: String) -> Result<String, String>`: `~/.perch/attachments/<16자 hex>.<확장자>`에 저장하고 절대 경로를 돌려준다. 허용: `image/png`→png, `image/jpeg`→jpg, `image/gif`→gif, `image/webp`→webp. 그 밖은 `"지원하지 않는 이미지 형식입니다"`. 20 MiB 초과는 `"이미지가 너무 큽니다 (20MB 제한)"`. 순수 함수 `fn image_ext(mime: &str) -> Option<&'static str>`를 테스트한다.
- `backend.ts`: `export const chatSaveImage = (bytes: Uint8Array, mime: string) => invoke<string>("chat_save_image", { bytes: Array.from(bytes), mime });`
- `composer.ts`: `export function enterAction(e: { key: string; shiftKey: boolean; isComposing: boolean; keyCode: number }): "send" | "newline" | "none"`.
- `ChatComposer({ running, disabled, focused, onSend, onStop }: { running: boolean; disabled: boolean; focused: boolean; onSend: (text: string, attachments: { path: string; mime: string }[]) => void; onStop: () => void })`.

**동작:** `<textarea rows={1}>`가 내용에 맞춰 최대 8줄까지 늘어난다. `enterAction`이 `"send"`면 `preventDefault` 후 전송(앞뒤 공백을 뺀 글이 비고 첨부도 없으면 무시), 전송 후 비운다. paste 이벤트에서 `clipboardData.items` 중 `image/*` 파일이 있으면 `chatSaveImage`로 저장하고 썸네일(`URL.createObjectURL`)과 × 버튼을 보인다. 글이 같이 있으면 글은 기본 동작으로 들어간다. `running`이면 버튼이 "중지"(`onStop`), 아니면 "전송". `focused`가 true가 되면 textarea에 포커스. 저장 실패 문구는 입력창 위에 한 줄로.

- [ ] **Step 1: 테스트**

```ts
it("enter rules incl. Korean IME", () => {
  const k = (o: Partial<Parameters<typeof enterAction>[0]>) => enterAction({ key: "Enter", shiftKey: false, isComposing: false, keyCode: 13, ...o });
  expect(k({})).toBe("send");
  expect(k({ shiftKey: true })).toBe("newline");
  expect(k({ isComposing: true })).toBe("none");   // composing Hangul: Enter only commits
  expect(k({ keyCode: 229 })).toBe("none");        // WebView2 reports 229 while composing
  expect(k({ key: "a", keyCode: 65 })).toBe("none");
});
```
Rust: `image_ext("image/png") == Some("png")`, `image_ext("image/svg+xml") == None`, `image_ext("text/plain") == None`.

- [ ] **Step 2–4:** 실패 확인, 구현, 세 검증 명령.
- [ ] **Step 5:** 커밋 `feat(desk): chat composer with IME-safe Enter and image paste`.

---

## 단계 4: 승인과 질문

### Task 6: 칸 안 버튼과 사이드바 연결

**Files:** Create `desk/src/components/ChatPrompt.tsx`. Modify `chatSession.ts`, `chatSession.test.ts`, `ChatView.tsx`, `chat.css`, `backend.ts`, `useTauriDesk.ts`, `desk/src-tauri/src/desk.rs`.

**Interfaces — Produces:**
- reducer: `approval.request` / `clarify.request` 이벤트 → `prompts`에 추가(payload: `prompt_id`, `execution_generation`, `choices`, `command`, `description`, `question`). `approval.settled` / `clarify.settled` → `prompt_id`로 제거. `snapshot` → `prompts = snap.prompts` 변환(`CanonicalPendingPrompt`와 같은 필드). 같은 `prompt_id`가 다시 와도 하나만.
- `ChatPrompt({ prompt, onApproval, onClarify }: { prompt: ChatPrompt; onApproval: (choice: string) => void; onClarify: (answer: string) => void })`: 승인은 `command`와 `description`을 보여주고 `choices`마다 버튼. 버튼 글자: `once`→"한 번 허용", `session`→"이 세션 동안 허용", `always`→"항상 허용", `deny`→"거부", 그 밖은 값 그대로. 질문은 `question`과 `choices` 버튼, 그리고 직접 입력 칸(Enter로 답, `enterAction` 재사용).
- Rust `session_approve`: 세션에 연결된 칸이 chat이면 PTY 대신 `app.emit("desk://chat-approve", { paneId, allow })`. 칸이 없으면 지금처럼 오류(프런트가 세션을 연다).
- 새 Rust 명령 없음. 중지는 프런트에서 처리: `useTauriDesk.stop`이 chat 칸이면 `emit("desk://chat-stop", { paneId })`(`@tauri-apps/api/event`의 `emit`), 아니면 지금처럼 `\x03`.
- `backend.ts`: `onChatApprove(cb: (p: { paneId: string; allow: boolean }) => void)`, `onChatStop(cb: (p: { paneId: string }) => void)`, `emitChatStop(paneId)`.
- `ChatView`가 두 이벤트를 듣고 자기 `paneId`일 때만: approve는 열린 승인 중 첫 번째에 `allow ? "once" : "deny"`(그 값이 `choices`에 없으면 allow는 `choices[0]`, deny는 `choices`의 마지막), stop은 `stop()`.

**확인할 것(구현자):** 실제 choice 값과 payload 필드를 `D:\hermes-cli\app\ui-tui\src\app\gatewayCanonicalEvents.ts`(`openCanonicalApproval`, clarify 쪽)와 `useApprovalAnswers.ts`, `tui_gateway/contracts/canonical.py`에서 확인하고, 위와 다르면 보고서에 적는다.

- [ ] **Step 1: 테스트** — request 추가, 같은 id 중복 없음, settled 제거, snapshot의 `prompts` 복원, 승인 요청이 열려 있어도 `message.delta`가 계속 쌓임.
- [ ] **Step 2–4:** 실패 확인, 구현, 세 검증 명령.
- [ ] **Step 5:** 커밋 `feat(desk): approval and clarify prompts in chat panes`.

**메인 검증:** `approvals.mode`가 manual인 상태에서 위험 명령(임시 폴더의 `rm -r`)을 시켜 버튼이 뜨는지, 칸 안 버튼과 사이드바 버튼 둘 다로 답해 보는지, 칸을 닫았다 다시 열면 요청이 복원되는지. 여기서 `client.capabilities`가 필요하면 `useChatSession` 시작 순서에 더하도록 같은 subagent에 요청.

---

## 단계 5: 메뉴와 사이드바

### Task 7: 보기 선택과 기본값

**Files:** Modify `desk/src/lib/uiSettings.ts`, `uiSettings.test.ts`, `desk/src/components/NewPaneMenu.tsx`, `desk/src/App.tsx`, `desk/src/lib/useTauriDesk.ts`, `desk/src/components/PaneHeader.tsx`.

**Interfaces — Produces:**
- `NewPaneDefaults = { agent: AgentKind; cwd: string; view: PaneView }`. `loadNewPane`: 저장값의 `view`가 `"tui"`일 때만 tui, 그 밖(없음 포함)은 `"chat"`. agent가 hermes가 아니면 `view`는 무시된다.
- 메뉴의 Agent 목록: `Hermes`(hermes+chat), `Hermes (TUI)`(hermes+tui), `OpenCode`, `Shell`. 버튼 표시 이름도 같다.
- `addPane(agent, cwd, view)`와 `App.tsx`의 `open`이 `view`를 넘긴다.
- `focusSession`: 칸이 없는 hermes 세션은 `paneCreate("hermes", s.cwd, sessionId, <현재 NewPaneDefaults의 view>)`. `useTauriDesk`가 기본 보기를 인자나 ref로 받는다.
- `PaneHeader`: chat 칸과 TUI 칸을 구분하는 작은 표시(예: 아이콘 `MessageSquare` / `SquareTerminal`, lucide-react에 있음).
- chat 칸의 오류 화면(Review Focus 5): `conn === "error"`면 `state.error`와 "다시 연결" 버튼, `hermes`가 없으면 `"hermes 실행 파일을 찾을 수 없습니다"`.

- [ ] **Step 1: 테스트** — `loadNewPane`: 저장값 없음 → chat, `{agent:"hermes"}`(옛 형식) → chat, `{agent:"hermes",view:"tui"}` → tui, `view:"x"` → chat.
- [ ] **Step 2–4:** 실패 확인, 구현, `npx vitest run`, `npx tsc --noEmit -p .`.
- [ ] **Step 5:** 커밋 `feat(desk): Hermes opens as chat by default, TUI stays selectable`.

**메인 검증:** 사이드바 상태(작업 중 / 승인 대기 / 완료), 폴더 그룹, 보관, 사용량 화면의 토큰이 chat 세션에서도 맞는지 TUI 세션과 나란히 확인.

---

## 단계 6: 끊김 처리와 문서

### Task 8: 재연결과 마무리

**Files:** Modify `desk/src/lib/chatSession.ts`, `chatSession.test.ts`, `ChatView.tsx`, `README.md`, `desk/HERMES_UI_NOTES.md`, `docs/ADAPTERS.md`.

- `onClosed`: `conn = "closed"`. 자동 재연결 1회(1초 뒤): `chatConnect` → `session.resume {session_id: state.sessionId}` → `snapshot`. 실패하면 `conn = "error"`와 "다시 연결" 버튼. 수동 `reconnect()`는 같은 순서.
- 재연결 중 스트리밍이던 assistant 항목은 스냅샷으로 대체된다(중복 없음). 테스트: closed 후 snapshot → 항목이 스냅샷 기준으로 바뀌고 `conn === "ready"`.
- `session.replay_gap` 이벤트가 오면 `session.resume`을 다시 호출한다.
- 문서: README에 채팅 칸 설명과 Hermes(MIT) 표기, `HERMES_UI_NOTES.md`에 gateway wire 메모(Origin 403, `submission_id` 필수, 이벤트 목록), `ADAPTERS.md`에 chat 보기.

- [ ] **Step 1–4:** 테스트, 실패 확인, 구현, 세 검증 명령.
- [ ] **Step 5:** 커밋 `feat(desk): chat pane reconnect; docs`.

**메인 검증:** 설정 메뉴의 gateway 중지로 연결을 끊고 자동 재연결과 대화 복원 확인. 전체 요구사항(스펙 "목표")을 하나씩 확인한 뒤 superpowers:finishing-a-development-branch.
