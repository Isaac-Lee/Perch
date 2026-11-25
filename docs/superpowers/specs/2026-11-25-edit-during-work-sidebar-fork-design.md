# Edit during work, and fork from the sidebar

Follows `2026-11-23-rewind-edit-fork-design.md`. That design disabled rewind, edit and fork while a session runs.

## Why

The user notices a wrong prompt while the agent is already working on it. Today they must press Stop, wait, then edit. They want to edit straight away and have Perch stop, take the conversation back and run the edited prompt. They also want to fork a session from the sidebar row, without scrolling to a message.

## Goals

- **Edit and rewind while the session runs.** Confirming an overwrite (or a rewind) on a running session stops the turn, drops queued input, rewinds to that message, and for an overwrite sends the edited text.
- **Fork from the sidebar row** of a Hermes chat pane. It forks from the end of the conversation.

## Non-goals

- Forking while the session runs. The user decided: fork is possible only when the work has ended. The message fork button, "포크해서 보내기" and the sidebar fork button are all disabled while running or while input is queued, with a tooltip.
- Sidebar fork for sessions without an open chat pane, and for TUI panes.

## Constraint

Hermes refuses `rewind` and `branch` unless the session is idle: no running turn and no queued admission (`require_idle`, `hermes_state_mutation_guards.py`). So Perch must make the session idle itself before it rewinds.

## Approaches

1. **Stop, then the existing rewind (chosen).** `prompt.cancel` every queued admission, `session.interrupt`, poll the session until it is idle, then the existing `rewind` mutation and send. No gateway change.
2. **Steer the running turn with the edited text.** No rewind, but the old prompt and its partial work stay in the transcript. Not what the user asked.
3. **Scheduled fork at turn end / stop then fork.** Offered for mid-work fork; the user chose not to fork during work at all.

## Behaviour

- **Buttons while running or queued.** `⟲ 되감기` and `✎ 편집` are enabled. `⑂ 포크` and `포크해서 보내기` are disabled: "작업이 끝난 뒤에 포크할 수 있습니다".
- **Confirm text while running or queued.** "진행 중인 작업을 멈추고, 이 메시지와 그 뒤 대화(대기 중인 메시지 포함)를 지웁니다. 되돌릴 수 없습니다".
- **Making it idle.** Cancel each queued admission, interrupt the turn, re-read the session; repeat a bounded number of times. If the session is still busy, stop with "작업을 멈추지 못했습니다"; nothing is rewound and the edited text goes back to the composer.
- **A bubble with no row id** (the prompt of the running turn; streamed bubbles get ids only from a snapshot). After the stop and re-read, the target is the user row that is new since before the stop and has the same text. If there is no such row, the interrupted turn left nothing to rewind: skip the rewind and continue (send the edited text, or put the text in the composer).
- When idle, a bubble with no row id stays disabled ("저장되는 중"), as before.
- **Sidebar fork.** A `⑂` button on the row of a session whose pane is a Hermes chat pane. Disabled while the session works. It tells the pane to fork (same event route as the sidebar Stop button). The pane branches the whole conversation (`branch` with no `through_message_id`) and opens the child in a new pane with an empty composer. The pane's own guard still refuses when busy.
- Text is never lost: any failure after the confirm puts the text in the composer with a local error row.

## Left to the builder

- Poll count and interval for "idle".
- Tests: `userActions` states, the row matching for a rowless bubble, and the stop-then-rewind flow with a mocked RPC where the existing tests allow.
