# thinking-orbs 0.3.2 (MIT, React, canvas 2D)

- `import { ThinkingOrb } from "thinking-orbs"` is the only component. It renders a `<canvas>`, so `className` and `style` pass through.
- Props: `state` (`working` | `searching` | `solving` | `listening` | `connecting` | `weaving` | `composing` | `breathing` | `shaping`), `size` (`64` | `32` | `20`), `theme` (`auto` | `dark` | `light`), `speed` (number, default 1), `paused` (boolean), `aria-label`.
- Pane header: `<ThinkingOrb state="working" size={20} theme="dark" />`. Footer loader: `<ThinkingOrb state="composing" size={20} theme="dark" />`. Always pin `theme="dark"`.
- It pauses by itself when offscreen or the tab is hidden, and shows a static frame under `prefers-reduced-motion`.

# Hermes shell-hook payload and late events (read from source, not measured live)

- Shell-hook stdin: `agent/shell_hooks.py` `_payload_fields` promotes only `tool_name`, `args` (as `tool_input`), `session_id`, `parent_session_id` to the top level; every other kwarg lands in `extra` (`user_message`, `assistant_response`, `turn_id`, `completed`, `interrupted`, ...). `session_id` falls back to `parent_session_id`, and `parent_session_id` is NOT in `extra`: `subagent_start/stop` carry the parent as top-level `session_id`. Perch used to read `extra.parent_session_id`, so subagent tracking never ran (child sessions got their own files); fixed in `run`.
- `post_llm_call` (`agent/turn_finalizer.py` ~500) passes `assistant_response=final_response` (full text, `json.dumps` untruncated) plus `conversation_history` (large) into `extra`; it fires before `on_session_end` (~912) and only when the agent is not `_persist_disabled`. Perch registers it and derives `asks`/`ask` (`last_question` in the hook crate).
- Late events: the post-turn memory/skill review fork (`agent/background_review.py` ~1092) shares the parent's `session_id`, is `_persist_disabled` (so its `pre_llm_call`, `on_session_end`, `post_llm_call` are suppressed) but its tool calls still fire `pre_tool_call`/`post_tool_call` (`model_tools._emit_post_tool_call_hook` has no persist gate) on a daemon thread after the turn ended. Those events used to flip an idle session to tool/thinking with no `on_session_end` to follow. Now tool events move `state` only while `turnStart` is set.
- `on_session_end` is skipped when `_persist_disabled`; interrupted CLI/gateway turns fire it with `interrupted=True` (`hermes_cli/cli_shutdown.py` ~202). Human-input resolved fires in a `finally` (`tools/human_input_hooks.py`), so it always arrives, possibly after the turn.
- Stop: sidebar/pane Stop sends the interrupt (chat: `emitChatStop` -> `session.interrupt`; TUI: Ctrl+C) and then calls `session_force_idle`, which after 1.5 s marks a still-working file idle.


# Measured with a real gateway (Hermes v0.23.2, nous/welcome): async delegation, session.info.running, side agents

- `delegate_task` is asynchronous. Turn 1 ends with `message.complete` (hook file idle), the child keeps running (`subagent.*` frames), and when it finishes the gateway starts turn 2 on its own: `session.info running:false pending:[queued]`, then `message.start` with `display_kind: "async_delegation_complete"` and no client submit, then `message.complete`. `execution_generation` (top level of every frame) goes 1, 2, ...
- `session.info` frames carry `running: true|false` and `pending: [{status: queued|started, outcome, execution_generation}]`; one follows every `message.start`/`message.complete`. Perch uses `running` as the gateway's own word (`applyRunning` in chatSession.ts).
- `prompt.submit` returns a receipt `{admission_id, ref, sequence, status: "queued", outcome: null, authority_epoch, execution_generation: null}`. `session.resume` on a finished session returns `running: false`.
- `session.interrupt` mid-turn: reply `execution_state: "running"`, then `message.complete` with `outcome: "cancelled"`, `status: "interrupted"` about 0.6 s later. Idle: `execution_state: "idle"`, no frames.
- `prompt.background` returns `{task_id}` and later emits only `background.complete`; `prompt.btw` returns `{task_id}` and emits only `btw.complete`. Neither sends `message.start`/`message.complete`/`session.info`.
- A second prompt sent while a turn runs queues (`pending: [started, queued]`) and runs after it; every turn got its own start/complete pair.
- The user's "stuck on Thinking after remote work" case could NOT be reproduced in about 12 runs (delegation, interrupts at several moments, queued prompts). Probably Hermes itself did not end the turn. Perch now follows `session.info.running`, resyncs after 45 s of silence, and Stop gets a second stage (see docs/HANDOFF.md).
- Hermes re-reads hook config for a running gateway on session create/resume (`gateway/session_policy.py:837` -> `agent/shell_hooks.py:185 sync_from_config`) and on a periodic profile reconcile that watches config.yaml and the allowlist (`gateway/run_profile_reconcile.py:150-165`); a gateway restart is not strictly needed. Classic CLI processes read it at start (`agent/shell_hooks.py:154 register_from_config`).
