# Hermes Agent v0.23.2 UI notes (what the Hermes mock panes imitate)

Source: `D:\hermes-cli\app` (read only). Layout = default `display.cli_layout: modern` (`cli_modern_layout.py:30`).
Locale = English (`display.language` default `en`; a `ko.yaml` exists in `locales/` but is only used if the user sets it).
Skin = `default` (`hermes_cli/skin_engine.py:64-79`). Colors below are truecolor from that skin.
Paths are relative to `hermes_cli/` unless noted; `en.yaml` = `locales/en.yaml`.

## Screen order (top to bottom)
Scrollback transcript, then the live region from `cli_tui_mixin.py:356-396` (`_build_tui_layout_children`):
modal panel (approval / clarify), hint row, live-work dock, composer top rule, composer, composer bottom rule, footer.
In modern layout the status bar is moved under the composer (`cli_tui_mixin.py:394-395`); the default
`display.statusbar` is `top` = visible (`cli_terminal_input.py:572-579`). The legacy spinner row and spacer are height 0 in modern
(`cli_status_bar_mixin.py:542-556`).

## Transcript (scrollback, width independent)
- Bars: `─` x40 (fixed `_SEPARATOR_WIDTH`, `cli_modern_layout.py:69`), accent `#FFBF00` for user/answer (`:78-85`).
- User message: blank, bar, `❯ text` (glyph accent bold, text bold), bar (`cli_stream_mixin.py:241-257`, `cli_modern_layout.py:101`).
  The blank line a closing bar owes is printed by whatever comes next (`:87-98`).
- Tool row, one per finished call: `<emoji> <Verb bold> <detail>  <0.2s dim>`; failure = red `✗` + `[exit 1]` (`:149-173`).
  Verbs/emoji from `agent/display.py:1248-1255`, `en.yaml:3598-3606`: terminal = `💻 $ cmd`, read_file = `📖 Read file`, patch = `🔧 Patch path`, search_files = `🔎 Grep pattern`.
- Answer: blank, accent bar, `☤ Hermes` (accent bold; timestamp only if `display.timestamps`), answer text `#FFF8DC`, accent bar (`:107-111`, `cli_chat_turn_mixin.py:752-756`, `cli_stream_mixin.py:485-497`).
- Turn footer after each turn, dim: `─ 6.2s · read 1 file · edited 1 file +4 -0 · 07:02 PM` (`:214-220`, `agent/turn_summary.py:147-190`).
- Reasoning blocks (`∴ Thought for 3s`, dim) exist (`:114-137`) but are not mocked.

## Composer
- Top rule (`cli_modern_layout.py:266-285`): idle = `─` full width, color `#8B8682` (`session_border`, `:248`).
  Busy = `── ⠹ <activity> · <turn time> · ↓ N tok ───…`: `── ` rule color, spinner frame accent bold (frames `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`, `:21`), activity default fg,
  extras dim `#8A7A4A`; session title right-aligned in `#DAA520` only when the session has a title.
- Activity text (`:232-237`): `_spinner_text`, or `Working…` (`en.yaml:1836`).
  Thinking: `<kaomoji> <verb>...` e.g. `(◔_◔) pondering...` (`agent/turn_iteration_prep.py:321-324`, `agent/display.py:853-865`).
  Tool: `<tool emoji> <preview>` e.g. `💻 npm test` (`cli_stream_mixin.py:810-821`).
  While an approval is open the spinner shows the command (`agent/display.py:412` comment).
- Prompt (`cli_tui_mixin.py:269-306`): idle `❯ ` (`#FFF8DC`); busy `☤ `, approval `⚠ `, clarify free-text `✎ ` (gold bold).
  Width >= 64 appends `❯ ` after the icon (`☤ ❯ `); width < 64 is "minimal chrome" (icon only, and no bottom rule, `cli_status_bar_mixin.py:515-519`, `cli_tui_mixin.py:95-103`).
- Placeholder, dim italic `#B8860B` (`cli_tui_mixin.py:769-808`): idle = one random example from `tips.placeholder.pNN` (`en.yaml:4106+`); busy = `type to redirect this turn · Tab queues it for after` (`en.yaml:1846`);
  approval = empty; clarify free-text = `type your answer here and press Enter` (`en.yaml:2297`).
- Bottom rule: `─` full width `#8B8682`, only when width >= 64.

## Footer (below the composer) — `cli_modern_layout.py:318-360`, `cli_status_bar_mixin.py:1019-1109`
- Left segments joined by dim ` · `: ` ☤ ` + model (gold `#FFD700` bold) (`:1044-1048`); then by width tier:
  `< 52`: duration only (`4m`, dim; `format_duration_compact`, `cli.py:257-269`);
  `52-75`: context percent (green `#8FBC8F` bold below 50 %, then `#FFD700`, `#FF8C00`, `#FF6B6B`; `:151-154`, `cli_status_bar_mixin.py:46-52`) + duration;
  `>= 76`: used/total context, `[█░░░░░░░░░] 12%` bar (`:151-154`), duration, prompt-elapsed `⏱ 2m 5s` / `✓ 42s` idle-since.
  Goal `⊙ goal 3/20` (`en.yaml:2777`) and `⎇ branch` only when set (branch is opt-in via `display.status_bar.fields`).
- Then ` · <cwd> (<git branch>)` in dim `#8A7A4A` when >= 12 cells remain, trimmed from the left with `…` (`cli_modern_layout.py:223-230, 349-354`).
- Right side (width >= 76, no modal open): key hints, key gold bold + text dim: idle `/ commands · @ files · ! shell`; busy `enter interrupt · tab queue · ctrl+c stop` (`:288-300`, `en.yaml:1837-1842`).
- No background fill (`_no_bg`, `:253-255`).

## Live-work dock (subagents / processes / goal / loop / queue) — `cli_subagent_monitor.py:208-300`, installed `:520-540`
- Sits directly above the composer top rule; hidden while any modal prompt is open (`:535-538`).
- Style: background `#1a1a2e`, text `#C0C0C0`, heading `#FFD700` bold (`skin_engine.py:524-525`); filled to full width.
- Heading `Subagents · 2 live · Ctrl+T expand · Ctrl+R collapse` (`en.yaml:2427`); rows ` ● <goal> · <elapsed>s · <activity>` where
  activity = `last: <tool>` or the raw status id or `starting` (`:194-200`, `en.yaml:2420`); `+N more · Ctrl+T all subagents` past the row budget `min(4, (rows-10)//3)`.
- Background processes (`cli_process_dock.py:81-96`): `Processes · 1 running` + ` ⚙ <command> · 12s · last: <output line>`; goal/loop/queue rows (`cli_session_dock.py:55-77`, `cli_subagent_monitor.py:226-232, 262-271`). Not mocked.

## Approval panel (`cli_tui_mixin.py:148-230`, `cli_panel.py`, `en.yaml:2224-2232, 2277`)
Rounded box `╭ ─ ╮ │ ╰ ╯`, border `#CD7F32`. Rows: title `⚠️  Dangerous Command` (`#ffa726` bold), blank, command (dim italic `#B8860B`), blank,
choices `❯ 1. Allow once` (selected `#FFD700` bold) / `2. Allow for this session` / `3. Add to permanent allowlist` / `4. Deny` (dim),
blank, description (`#FFF8DC` bold), e.g. `recursive delete` (matched rule `tools/approval_detection.py:501`).
A `view` choice (`Show full command`) is added when the command is > 70 chars (`cli_modal_mixin.py:1113-1126`).
Width: `_panel_box_width` min 46 / max 76, shrunk to terminal width - 6 (`cli_render.py:967-972`). Hint row above the rule:
`  ↑/↓ to select, Enter to confirm  (298s)` (dim italic, countdown `#CD7F32`, default timeout 300 s, `cli_modal_mixin.py:1078`).
**Hermes has four choices (once / session / always / deny), not three.**

## Clarify panel (`cli_tui_mixin.py:422-534`, `en.yaml:2236-2242`)
Title inlined in the top border: `╭─ Hermes needs your input ───╮` (gold bold). Rows: `1 question` (`#FFF8DC` bold), `▸ <question>` (gold bold),
and for a question without choices (free text, `cli_modal_mixin.py:924`) the guidance `  Type your answer in the prompt below, then press Enter.` (gold italic).
Hint row `  type your answer and press Enter  (88s)` (`en.yaml:2285`; countdown shown unless timeout <= 0; default 90 s, `tools/clarify_gateway.py:281-291`).
Choice questions add `  ❯ 1. <choice>` rows plus `Other (type your answer)`; not mocked.

## Approximated / not determinable from code
- Model name `qwen3:8b`, context 12 % / `12.3k/32k`, session duration (taken from the mock session's `turnStart`/`since`): runtime data.
- Token flow `↓ N tok`: formula is real (`agent/turn_summary.py:196-208`), the count is invented from elapsed seconds.
- Spinner frame is a fixed `⠹` (Hermes cycles at 10 fps); kaomoji/verb for "thinking" are random in Hermes (fixed `(◔_◔) pondering...` here).
- Idle composer placeholder is random per session in Hermes (fixed `Find and fix a failing test`, one of the catalog entries).
- Transcript content (tool rows, durations, answer text, turn footer values) is invented per state; only the format is from source. Tool rows show `Read app.ts`-style
  short names; Hermes prints whatever `build_tool_preview` yields for the real arguments.
- Subagent activity shows `running` (the real raw status id was not traced; with a known tool it shows `last: <tool>`).
- Clarify spinner activity (`❓  clarify`) is a guess: the tool's emoji is `❓` (`tools/clarify_tool.py:223`) but the spinner text for it was not traced.
- Approval/clarify countdown values (298 s / 88 s) are static snapshots.
- Emoji width: xterm.js (Unicode 6, no extra addon allowed) counts emoji as 1 cell while Hermes/prompt_toolkit assumes 2, so the mock adds one extra space after each emoji
  to keep spacing, and panel padding uses xterm's count so borders stay straight.
- The separator bars are clamped to the pane width (Hermes always prints 40).
- Stop button: Hermes would print an interrupt notice; the mock just redraws the idle composer.
- Not mocked: banner at startup, pet pane, voice bar, stash panel, slash-command menus, sudo/secret prompts, model picker.

## Gateway (chat view) notes
Wire contract `hermes-gateway-v1`, newline-delimited JSON-RPC over a WebSocket. Measured against Hermes v0.23.2; see the design spec for details.
- `hermes gateway attach --json --start` prints the `url` and `protocols`. The one-time ticket is carried in the WebSocket subprotocol, valid once and for about 30 s, so every connect asks for a fresh one. Never store or log it.
- The gateway answers 403 to any request that has an `Origin` header. A webview always sends one, so it cannot connect itself; the Rust side (`gateway.rs`) connects and relays lines (`chat_connect` / `chat_send` / `chat_close`). When the socket ends, the relay sends one last line `{"perch":"closed","reason":"..."}`.
- `prompt.submit` requires a `submission_id`.
- Approvals and questions arrive as events (`approval.request`, `clarify.request`). Answer with `approval.respond` / `clarify.respond` using the prompt's own `execution_generation`, not the session's current one.
- Images must be staged first with `image.attach_bytes`; the returned path goes into the `prompt.submit` attachments.
- `session.resume` returns raw model-API message rows (user / assistant with tool_calls / tool), not UI items. `session.replay_gap` means events were lost; resume again to re-read the session.
- Shell hooks fire for gateway sessions too, so the sidebar status needs nothing extra.
- Closing the socket does not stop the turn. The gateway may exit when idle or be restarted; the chat view reconnects once automatically and resumes the session.
