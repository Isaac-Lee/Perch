# Rewind, Edit and Fork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From any of the user's own messages in a Hermes chat pane, let the user rewind to it, edit and resend it (overwrite or fork), or fork the conversation into a new pane next to the current one.

**Architecture:** User items keep the Hermes `row_id` from `display_messages`. Pure helpers in `chatSession.ts` decide the fork boundary and whether the actions are enabled. The `useChatSession` hook gains `rewindTo`, `overwrite` and `fork`, built on its existing `mutate()` helper (`session.mutate` with revision/generation and one stale retry). A small prefill registry hands text to the forked pane's composer. `ChatMessage` renders the hover actions and the inline editor.

**Tech Stack:** React 19 + TypeScript, vitest, Tauri 2 (no Rust change).

**Spec:** `docs/superpowers/specs/2026-11-23-rewind-edit-fork-design.md`

## Global Constraints

- Work on branch `feat/rewind-fork`, cut from `release/0.9.1` (it needs `display_projection`, `localError` and `display_messages` from 0.9.1). Rebase it onto `main` once 0.9.1 is merged.
- Hermes RPCs exactly as in the spec:
  - `session.mutate` operation `rewind`, payload `{target_message_id}`; the result has `target_message.content`.
  - `session.mutate` operation `branch`, payload `{through_message_id}`; the result has `branched_session_id`.
  - `session.create {request_id, source: "tui", cwd, model?, reasoning?}`.
- UI copy (Korean, as in the spec): `⟲ 되감기`, `✎ 편집`, `⑂ 포크`, `여기서 덮어쓰기`, `포크해서 보내기`, `취소`.
  - Rewind/overwrite confirm: `이 메시지와 그 뒤 대화가 지워집니다. 되돌릴 수 없습니다`.
  - Disabled reasons: `작업 중에는 쓸 수 없습니다` (running or queued), `저장되는 중` (no row id yet).
  - Row gone on retry: `대화가 바뀌어 되감지 못했습니다`.
- The user's text must always end up delivered or in a composer. A fork never changes the parent session or the parent's composer.
- Run from `desk/`: `npx vitest run`, `npx tsc --noEmit -p .`, `npm run lint` (no new warnings).

## Review Focus

1. **Rewind while a queued prompt exists:** the actions are disabled. Hermes `require_idle` would refuse anyway, but the user must not see a gateway error for it.
2. **Live bubbles right after a turn:** a bubble sent in this pane has no `row_id` until the post-turn resync. Its actions show `저장되는 중` and never act on a guessed id.
3. **Forking the first message,** or a message whose earlier rows all lack `row_id`: a plain new session with the parent's cwd, model and effort, not a `branch` call.
4. **Compacted target:** Hermes refuses with a `compacted:` detail. Show it as a local error row, and put the text in the composer.
5. **Older gateway:** a snapshot without `display_messages` hides the actions entirely.

---

### Task 1: Row ids, fork boundary and action state

**Files:**
- Modify: `desk/src/lib/chatSession.ts` (`ChatItem` user variant, `ChatState`, `initialChat`, `transcriptToItems` ~79, `snapshot` case ~162, `message.complete` handling in `useChatSession`)
- Test: `desk/src/lib/chatSession.test.ts`

**Interfaces:**
- Produces:
  - User `ChatItem` gains `rowId?: number` (its own Hermes row) and `prevRowId?: number` (the nearest earlier row with a `row_id`, any role).
  - `ChatState.rowIds: boolean`. True when the last snapshot carried `display_messages`. `initialChat.rowIds = false`.
  - `export function forkBoundary(item: ChatItem): { through: number } | { fresh: true }`
  - `export function userActions(s: Pick<ChatState, "running" | "queued" | "rowIds">, item: ChatItem): { show: boolean; enabled: boolean; reason?: string }`

- [ ] **Step 1: Write the failing tests**

```ts
describe("row ids", () => {
  const rows = [
    { role: "user", text: "a", row_id: 1 }, { role: "assistant", text: "A", row_id: 2 },
    { role: "user", text: "b", row_id: 4 }, { role: "user", text: "", row_id: 5 },
  ];
  it("user items carry their row id and the nearest earlier row id", () => {
    const u = transcriptToItems(rows).filter((i) => i.kind === "user");
    expect(u).toMatchObject([{ text: "a", rowId: 1 }, { text: "b", rowId: 4, prevRowId: 2 }]);
    expect((u[0] as any).prevRowId).toBeUndefined();
  });
  it("forkBoundary: through the previous row, or fresh for the first message", () => {
    const u = transcriptToItems(rows).filter((i) => i.kind === "user");
    expect(forkBoundary(u[1])).toEqual({ through: 2 });
    expect(forkBoundary(u[0])).toEqual({ fresh: true });
  });
  it("snapshot sets rowIds only when display_messages came", () => {
    expect(chatReducer(initialChat, { t: "snapshot", snap: { session_id: "s", display_messages: rows } }).rowIds).toBe(true);
    expect(chatReducer(initialChat, { t: "snapshot", snap: { session_id: "s", messages: rows } }).rowIds).toBe(false);
  });
  it("userActions: hidden without row ids, disabled while busy or unsaved", () => {
    const item = { kind: "user", id: "u", text: "x", rowId: 3 } as const;
    expect(userActions({ running: false, queued: [], rowIds: false }, item).show).toBe(false);
    expect(userActions({ running: true, queued: [], rowIds: true }, item)).toEqual({ show: true, enabled: false, reason: "작업 중에는 쓸 수 없습니다" });
    expect(userActions({ running: false, queued: [{} as any], rowIds: true }, item).reason).toBe("작업 중에는 쓸 수 없습니다");
    expect(userActions({ running: false, queued: [], rowIds: true }, { ...item, rowId: undefined })).toEqual({ show: true, enabled: false, reason: "저장되는 중" });
    expect(userActions({ running: false, queued: [], rowIds: true }, item)).toEqual({ show: true, enabled: true });
    expect(userActions({ running: false, queued: [], rowIds: true }, { kind: "system", id: "s", text: "x" }).show).toBe(false);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run src/lib/chatSession.test.ts -t "row ids"`
Expected: FAIL (`forkBoundary` / `userActions` not exported, `rowId` missing).

- [ ] **Step 3: Implement**
  - In `transcriptToItems`, track `last: number | undefined` = the latest numeric `m.row_id` seen across all rows, skipped ones included. A user item gets `rowId: m.row_id` and `prevRowId: last` (the value before this row).
  - `snapshot` sets `rowIds: Array.isArray(a.snap.display_messages)`.
  - `forkBoundary` returns `{ through: item.prevRowId }` when it is a number, else `{ fresh: true }`.
  - `userActions` checks in this order: `show` = user item and `rowIds`; busy = `running || queued.length > 0`; then `rowId` missing.

- [ ] **Step 4: Post-turn resync**
  - In `useChatSession`'s frame handler, after a `message.complete` frame, call `resync()` once. Use the same `void resync()` form as the watchdog.
  - `resync` already adopts the snapshot only when the gateway says the turn is not running, so a queued next turn is left alone.

- [ ] **Step 5: Run tests and the type check**

Run: `npx vitest run && npx tsc --noEmit -p .`
Expected: all pass.

- [ ] **Step 6: Commit** — `feat(desk): keep Hermes row ids on chat user messages`

### Task 2: Hook actions and fork prefill

**Files:**
- Create: `desk/src/lib/forkPrefill.ts`
- Modify: `desk/src/lib/chatSession.ts` (`useChatSession` return object, next to `mutate` ~600; the idle-path `fail` in `submit` ~552)
- Modify: `desk/src/lib/useTauriDesk.ts` (focus listener)
- Test: `desk/src/lib/forkPrefill.test.ts`

**Interfaces:**
- Consumes: `forkBoundary`, `ChatItem.rowId` (Task 1); the existing `mutate(operation, payload)`, `resync()`, `setDraft`, `send()` and `paneCreate` (from `./backend`).
- Produces:
  - `forkPrefill.ts`:
    - `export function setPrefill(sessionId: string, p: { text: string; send: boolean }): void`
    - `export function takePrefill(sessionId: string): { text: string; send: boolean } | undefined` (removes the entry)
    - `export const FOCUS_PANE_EVENT = "perch:focus-pane"`
  - Hook additions:
    - `rewindTo(rowId: number): Promise<void>`. Calls `mutate("rewind", { target_message_id: rowId })`, then `resync()`, then `setDraft` with `target_message.content` (a string; for array content, join the text parts).
    - `overwrite(rowId: number, text: string): Promise<void>`. The same rewind and resync, then `send(text)`.
    - `fork(item: ChatItem, text: string, sendNow: boolean): Promise<void>`
  - Every failure in these three dispatches `localError`. For `revision_conflict` or invalid target errors, the text is `대화가 바뀌어 되감지 못했습니다`; otherwise it is the gateway message. Each failure also puts `text` (or the target's text) in this pane's composer through `setDraft`.

- [ ] **Step 1: Write the failing test**

```ts
import { setPrefill, takePrefill } from "./forkPrefill";
it("prefill is taken once per session", () => {
  setPrefill("s1", { text: "hi", send: true });
  expect(takePrefill("s1")).toEqual({ text: "hi", send: true });
  expect(takePrefill("s1")).toBeUndefined();
  expect(takePrefill("other")).toBeUndefined();
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/forkPrefill.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `forkPrefill.ts`** — a module-level `Map<string, {text, send}>`.

- [ ] **Step 4: Implement the hook actions**
  - `fork`:
    - `forkBoundary(item)` decides the call. `{through}` calls `mutate("branch", { through_message_id: through })` and uses `branched_session_id`. `{fresh}` calls `rpc.request("session.create", { request_id: crypto.randomUUID(), source: "tui", cwd, model: state.model ?? undefined, reasoning: state.effort ?? undefined })` and uses its `session_id`.
    - Then `setPrefill(child, { text, send: sendNow })` and `paneCreate("hermes", cwd, child, "chat")`. When that resolves, dispatch `window.dispatchEvent(new CustomEvent(FOCUS_PANE_EVENT, { detail: paneId }))`.
    - If `branch` succeeds but `paneCreate` fails, leave the child session as it is (spec), and show the error.
  - The existing `mutate` retry (`staleRetry`) is the single retry the spec allows. Hermes rejects a rewind or branch whose row id is no longer an active row, so the "same row still there" check is the gateway's own.
  - The idle-path `fail` in `submit` also calls `setDraft` with the text, so a failed overwrite send lands in the composer.

- [ ] **Step 5: Mount-time prefill in the child pane**
  - In `useChatSession`, after the first snapshot of a pane opened with `resumeId`, run `takePrefill(snap.session_id)`.
  - If it is found with `send: true`, call `send(text)`. Otherwise call `setDraft({ text, n })`.

- [ ] **Step 6: Focus listener**
  - In `useTauriDesk`, add a `useEffect` that listens for `FOCUS_PANE_EVENT` on `window` and calls `setFocused(e.detail)`. Remove the listener on cleanup.

- [ ] **Step 7: Run tests and the type check**

Run: `npx vitest run && npx tsc --noEmit -p .`
Expected: all pass.

- [ ] **Step 8: Commit** — `feat(desk): rewind, overwrite and fork actions for chat sessions`

### Task 3: Bubble actions, inline editor and draft stash

**Files:**
- Modify: `desk/src/components/ChatMessage.tsx` (user bubble)
- Modify: `desk/src/components/ChatView.tsx` (pass actions, extra history)
- Modify: `desk/src/components/ChatComposer.tsx` (`onDraftReplaced`)
- Modify: `desk/src/styles/chat.css`
- Test: none new. The project has no component test setup (no testing-library or jsdom), and adding one is out of scope. `userActions` (Task 1) and the hook actions (Task 2) carry the logic; the UI is verified in the app (Step 5).

**Interfaces:**
- Consumes: `userActions` (Task 1); `rewindTo`, `overwrite`, `fork` (Task 2).
- Produces:
  - `ChatMessage` prop `actions?: { state: { show: boolean; enabled: boolean; reason?: string }; onRewind: () => void; onOverwrite: (text: string) => void; onFork: (text: string, sendNow: boolean) => void }`. It is passed only for user items. Keep `memo` working by building `actions` per item with `useCallback`/`useMemo` in ChatView, keyed by item id and the action state.
  - `ChatComposer` prop `onDraftReplaced?: (old: string) => void`. It is called when a `draft` arrives while the composer holds non-empty text different from the draft.

- [ ] **Step 1: Implement the bubble UI**
  - Actions bar: visible on hover and on keyboard focus within the bubble.
  - Buttons: `⟲ 되감기`, `✎ 편집`, `⑂ 포크`.
    - `⑂ 포크` with no edit calls `onFork(item.text, false)`.
  - Confirm inline, the way `SettingsMenu`'s gateway restart does (its `"ask"` state). The first press of `⟲ 되감기` or `여기서 덮어쓰기` shows the confirm copy from Global Constraints with `확인` and `취소`, and only `확인` calls the action. The app does not use `window.confirm`.
  - Edit mode: a textarea prefilled with `item.text`, plus `여기서 덮어쓰기`, `포크해서 보내기` and `취소`. Esc cancels. `포크해서 보내기` calls `onFork(editedText, true)`.
  - Every button gets a `title` (the disabled reason when disabled) and is reachable by keyboard.

- [ ] **Step 2: Wire it in ChatView**
  - Compute `userActions(state, item)` per user item and pass `actions`.
  - Keep `extra: string[]` state, fed by `onDraftReplaced`. Pass `[...extra, ...history]` as the composer's `history`, so the user can recall a draft replaced by a rewind with ↑.

- [ ] **Step 3: CSS**
  - Style the actions bar and the editor in `chat.css`, using the existing tokens (`--text-3`, borders, radius).
  - The bar must not overlap the bubble text in a 380 px pane.

- [ ] **Step 4: Run checks**

Run: `npx vitest run && npx tsc --noEmit -p . && npm run lint`
Expected: pass, no new lint warnings.

- [ ] **Step 5: Verify in the app** (the `run` skill, or `npm run tauri dev`) against a real Hermes gateway:
  - Rewind a middle message. Later messages disappear and the text is in the composer.
  - Overwrite. The new reply replaces the tail.
  - Fork. A new pane opens and takes focus, the original is unchanged, and the composer holds the text.
  - Fork the first message. A fresh session opens with the same model.
  - While a turn runs, the actions are disabled with the reason.

- [ ] **Step 6: Commit** — `feat(desk): rewind, edit and fork buttons on chat messages`
