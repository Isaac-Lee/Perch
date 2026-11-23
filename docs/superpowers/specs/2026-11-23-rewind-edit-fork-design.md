# Rewind, edit and fork in the Hermes chat view

## Why

The user wants to go back to a point in a chat, change a prompt they already sent, and try a different prompt from the same point while keeping the original. The main use is comparing two answers to two prompts side by side.

## Goals

- From any of my user messages in a Hermes chat pane:
  - **Rewind**: drop this message and everything after it, and put its text back in the composer.
  - **Edit**: change the text, then either overwrite (rewind and send) or fork (keep the original, send the edit in a new session).
  - **Fork**: open a new session that holds the conversation up to just before this message, in a new pane next to the current one, with this message's text in its composer.
- The original conversation is never changed by a fork.

## Non-goals

- Rewinding to an assistant message, or forking after an assistant message without a following user message. The entry points are user messages only.
- Forking or rewinding TUI panes. Chat view only.
- Undo of a rewind. Hermes deletes the rows; we warn instead.
- A history tree view of forks.

## Anti-goals

- Re-running the model or tools to rebuild a conversation. Forks must be exact copies of what was there.
- Losing the user's text. If any step fails, the text ends up in a composer.
- Silent destruction. Rewind and overwrite always confirm first, and the confirmation says that later messages will be deleted.

## Constraints (from Hermes source, `D:\hermes-cli\app`)

- Both operations are `session.mutate` with `request_id`, `expected_revision`, `expected_generation`, `operation`, `payload` (`gateway/session_mutations.py`, `hermes_state_runtime.py` ~575). A wrong revision or generation is refused (`revision_conflict`, `stale_generation`).
- `rewind` payload `{target_message_id}` must name an active **user** row (`hermes_state_mutations.py` `_rewind`). It removes that row and everything after, bumps the generation, and returns `target_message` whose `content` is the typed prompt. A row summarized by compaction is refused with a `compacted:` detail.
- `branch` payload `{through_message_id}` copies rows through that id, plus the tool rows that answer an assistant boundary (`hermes_state_mutation_branch.py` `_branch_boundary`). It returns `branched_session_id`. The child starts with edit approval at `ask`. Hermes Desktop sends `through_message_id` the same way (`apps/desktop/src/api/canonical-protocol.ts` `branchBoundary`).
- Both require the session to be idle, including no queued input (`require_idle`).
- Message ids: `session.resume` with `display_projection: true` returns `display_messages` rows with `row_id` (`tui_gateway/session_history.py` ~357). Streamed messages carry no row id until the next resume.

## Approaches

1. **Gateway mutations (chosen).** Call `rewind` and `branch` directly. Exact copies, no model or tool re-runs, works at any user message. Costs: we must send the current revision and generation, and we need a resync after each turn so new messages get `row_id`.
2. **Slash commands** (`/undo`, `/branch`). Least code, but `/undo` only takes back the last turn and `/branch` copies the whole history, so "a specific point" is impossible.
3. **New session and replay the prompts.** No gateway dependency, but the model answers again and tools run again, so the copy is not the same conversation.

The user picked 1.

## Decided

- The fork opens in a **new pane next to the current one** (user's choice).
- Entry points: hovering a user bubble shows `⟲ 되감기 · ✎ 편집 · ⑂ 포크`.
- Edit opens the bubble as a textarea with `[여기서 덮어쓰기]`, `[포크해서 보내기]` and `[취소]`.
- While the session is running, or has queued input, all three are disabled, and a tooltip gives the reason.

```
┌ 내 말풍선 ─────────────────────┐
│ README 첫 줄 읽어줘              │
└──────────── ⟲ 되감기 · ✎ 편집 · ⑂ 포크 ┘

✎ 편집:
┌──────────────────────────────┐
│ README 첫 세 줄 읽어줘_          │
└──────────────────────────────┘
  [여기서 덮어쓰기]  [포크해서 보내기]  [취소]
```

## Behaviour

- **Row ids.** User items keep the `row_id` from `display_messages`. After `message.complete` the pane re-reads the session (`session.resume` with `display_projection: true`, as the existing resync does) so the new rows get ids. A user bubble with no `row_id` yet shows the buttons disabled ("저장되는 중").
- **Rewind.** Confirm ("이 메시지와 그 뒤 대화가 지워집니다. 되돌릴 수 없습니다"). Then `rewind {target_message_id: row_id}`, then a resync, then put `target_message.content` in the composer.
- **Overwrite (edit).** The same as rewind, then submit the edited text instead of filling the composer.
- **Fork.** `through_message_id` = the `row_id` of the last row before this user message. When the message is the first one, create a plain new session with the same cwd instead. Open the child in a new Hermes chat pane next to the current pane, resumed by `branched_session_id`, with the message's text (or the edited text) in its composer. For "포크해서 보내기" the child sends the text right away.
- **Errors.**
  - On `revision_conflict` or `stale_generation`, resync once and retry once.
  - When the session is busy, or the target row was compacted, show the gateway's reason as a local error row (the non-terminal one from 0.9.1).
  - The text always ends up in a composer.

## Calls made while writing this (check these)

- **Fork boundary.** `through_message_id` = the `row_id` of the nearest earlier `display_messages` row that has one, of any role. `_branch_boundary` accepts any active row and extends an assistant boundary through its tool rows. If no earlier row has a `row_id`, fork as "first message".
- **Matching.** Buttons act on a bubble's own `row_id` only, never on its position. Bubbles get `row_id` only from a snapshot row. Optimistic bubbles stay without one until the resync replaces the items. `steer` and `skill_invocation` user rows get the buttons. System lines (gateway-made user rows) do not.
- **Retry.** On `revision_conflict` or `stale_generation`: resync, then retry once, only if the same `row_id` is still in the fresh snapshot. If it is gone, stop and say "대화가 바뀌어 되감지 못했습니다".
- **Partial failure.**
  - Overwrite: when the rewind succeeds but the submit fails, the edited text goes back to the composer with the error. The deleted tail stays deleted.
  - Fork: when `branch` succeeds but the pane fails to open, the child session is left as it is (it shows in the sidebar). No cleanup.
- **Existing draft.** Rewind replaces the composer text. When the composer is not empty, the old draft is pushed into composer history first, so it can be recalled. A fork never touches the parent's composer.
- **Pane placement.** A fork opens like any new pane (inserted after the current pane where the grid order allows, otherwise appended) and takes focus. There is no special capacity rule beyond what new panes already have.
- **First-message fork.** `session.create` with the parent's cwd, model and reasoning effort.
- **Older gateway.** When a snapshot has no `display_messages` (no row ids at all), the buttons are hidden. "저장되는 중" applies only to bubbles waiting for the post-turn resync.

## Left to the builder

- How `revision`/`execution_generation` are read from `ChatState` at call time (both are already tracked), and request id generation.
- How the new pane is placed "next to" the current one in `PaneGrid` (insert after the current pane if the grid order allows, else append and focus).
- How the child pane receives the composer prefill (an existing draft/prefill path, or a new prop on pane creation).
- Exact copy and tooltip wording, following the existing Korean UI tone.
- Tests: reducer cases for row ids from snapshots, the disabled states, and the error paths. Mock the RPC for the rewind, overwrite and fork flows.
