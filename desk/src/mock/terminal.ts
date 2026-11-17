import type { AgentKind, Session } from "../lib/types";

const g = (s: string) => `\x1b[32m${s}\x1b[0m`;
const d = (s: string) => `\x1b[90m${s}\x1b[0m`;
const c = (s: string) => `\x1b[36m${s}\x1b[0m`;

const opencode = [
  `${c("opencode")} ${d("1.4 · build agent")}`, "",
  `${g("> ")}CI 예제를 최신 버전으로 맞춰 주세요`, "",
  `${d("→")} Read   .github/workflows/ci.yml`, `${d("→")} Grep   "actions/checkout"`, `${d("  3 matches")}`,
  `${d("→")} Edit   .github/workflows/ci.yml`, `${d("  - uses: actions/checkout@v3")}`, `${d("  + uses: actions/checkout@v4")}`,
  `${d("→")} Bash   npm ci`, `${d("  added 412 packages in 6s")}`, "",
  "워크플로 3개를 갱신했습니다. 계속 확인합니다.", "",
];
const shell = [
  `${d("PS D:\\ysl\\st-alpha>")} git status`, "On branch main", "nothing to commit, working tree clean",
  `${d("PS D:\\ysl\\st-alpha>")} node --version`, "v24.1.0",
];

/** Blank cells carry no content and xterm skips them, so pad the row with spaces and step back; this lets the input band span the full width. */
const fill = (cols: number) => (cols > 3 ? " ".repeat(cols - 2) + `[${cols - 2}D` : "");

/** Written without a trailing newline so the cursor stays on the input line. */
export const terminalPrompt = (agent: Exclude<AgentKind, "hermes">, cols: number) =>
  agent === "shell" ? d("PS D:\\ysl\\st-alpha> ") + fill(cols - 18) :`${d("─".repeat(Math.max(cols, 1)))}\r\n❯ ${fill(cols)}`;

export const terminalLines: Record<Exclude<AgentKind, "hermes">, string[]> = { opencode, shell };

// ───────────── Hermes Agent v0.23.2, default "modern" layout, default skin, English locale ─────────────
// Strings, glyphs and colors come from the Hermes source; see desk/HERMES_UI_NOTES.md for file:line.

export type HermesView = Pick<Session, "state" | "prompt" | "tool" | "toolDetail" | "pending" | "subagents" | "cwd" | "branch" | "since" | "turnStart">;

/** Cells as xterm.js (Unicode 6 tables) counts them: 2 for Hangul/CJK, 0 for combining marks, 1 for emoji.
 *  Hermes in a real terminal gives emoji 2 cells, so the mock puts one extra space after each emoji. */
const cw = (ch: string) => {
  const n = ch.codePointAt(0)!;
  if (n === 0xfe0f || n === 0x200d || (n >= 0x300 && n <= 0x36f)) return 0;
  return (n >= 0x1100 && n <= 0x115f) || (n >= 0x2e80 && n <= 0xa4cf) || (n >= 0xac00 && n <= 0xd7a3) || (n >= 0xf900 && n <= 0xfaff) ||
    (n >= 0xff00 && n <= 0xff60) || (n >= 0xffe0 && n <= 0xffe6) ? 2 : 1;
};
const cells = (s: string) => [...s].reduce((a, ch) => a + cw(ch), 0);
const clip = (s: string, w: number) => {
  if (cells(s) <= w) return s;
  let out = "", used = 0;
  for (const ch of s) { if (used + cw(ch) > Math.max(0, w - 1)) break; out += ch; used += cw(ch); }
  return out + (w ? "…" : "");
};
/** Greedy word wrap by cells; a word wider than the row is split where the row ends (CJK has no spaces). */
const wrap = (s: string, w: number) => {
  const rows: string[] = [];
  let cur = "";
  for (const word of s.split(/(?<= )/)) {
    if (cells(cur + word.trimEnd()) <= w) { cur += word; continue; }
    if (cur.trim()) rows.push(cur.trimEnd());
    cur = "";
    for (const ch of word) { if (cells(cur + ch) > w) { rows.push(cur); cur = ""; } cur += ch; }
  }
  return [...rows, cur.trimEnd()];
};

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(";");
const fg = (h: string, bold = false) => `\x1b[${bold ? "1;" : ""}38;2;${rgb(h)}m`;
const RST = "\x1b[0m";
const paint = (h: string, t: string, bold = false) => `${fg(h, bold)}${t}${RST}`;
const ital = (h: string, t: string) => `\x1b[3m${fg(h)}${t}${RST}`;
const dimSgr = (t: string) => `\x1b[2m${t}${RST}`;
// default skin (skin_engine.py "default")
const K = { accent: "#FFBF00", rule: "#8B8682", border: "#CD7F32", title: "#FFD700", text: "#FFF8DC", dim: "#B8860B", warn: "#ffa726",
  sbBg: "#1a1a2e", sbText: "#C0C0C0", sbDim: "#8A7A4A", good: "#8FBC8F" };

const dur = (s: number) => (s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.floor(s / 3600)}h`); // format_duration_compact
const bar40 = (cols: number) => paint(K.accent, "─".repeat(Math.min(40, cols))); // _SEPARATOR_WIDTH = 40 (clamped so a narrow pane never wraps it)
const toolRow = (emoji: string, verb: string, detail: string, secs: number) => `${emoji}  \x1b[1m${verb}${RST} ${detail}  ${dimSgr(`${secs.toFixed(1)}s`)}`;

const transcript = (v: HermesView, cols: number): string[] => {
  if (!v.prompt) return [];
  const done: [string, string, string, number][] =
    v.state === "approval" ? [["💻", "$", "ls build/", 0.3]]
    : v.state === "question" ? [["📖", "Read", "deployment.yaml", 0.1], ["🔎", "Grep", "namespace", 0.2]]
    : v.state === "idle" || v.state === "closed" ? [["📖", "Read", "login.tsx", 0.1], ["🔧", "Patch", "src/login.tsx", 0.2]]
    : [["📖", "Read", "app.ts", 0.1], ["📖", "Read", "app.test.ts", 0.1], ["🔧", "Patch", "src/app.ts", 0.2]];
  // user row: blank, bar, "❯ text", bar; the blank the closing bar owes is paid by the first tool row
  const out = ["", bar40(cols), `${paint(K.accent, "❯", true)} \x1b[1m${v.prompt}${RST}`, bar40(cols), "", ...done.map((r) => toolRow(...r))];
  if (v.state === "idle" || v.state === "closed")
    out.push("", bar40(cols), paint(K.accent, "☤ Hermes", true), paint(K.text, "작업을 마쳤습니다. 변경 사항을 확인해 주세요."), bar40(cols), "",
      dimSgr("─ 6.2s · read 1 file · edited 1 file +4 -0 · 07:02 PM"));
  return out;
};

type Box = { border: string; w: number };
const top = ({ border, w }: Box, title?: string) =>
  title ? `${paint(border, "╭─ ")}${paint(K.warn, title, true)}${paint(border, ` ${"─".repeat(Math.max(0, w - cells(title) - 3))}╮`)}` : paint(border, `╭${"─".repeat(w)}╮`);
const row = ({ border, w }: Box, col: string, text: string, o: { bold?: boolean; italic?: boolean } = {}) =>
  `${paint(border, "│ ")}${o.italic ? "\x1b[3m" : ""}${fg(col, o.bold)}${text}${RST}${" ".repeat(Math.max(0, w - 2 - cells(text)))}${paint(border, " │")}`;
const blank = ({ border, w }: Box) => paint(border, `│${" ".repeat(w)}│`);
const bottom = ({ border, w }: Box) => paint(border, `╰${"─".repeat(w)}╯`);
/** _panel_box_width: min 46, max 76, shrunk to the terminal; returns the box width (inner + 2). */
const boxWidth = (title: string, lines: string[], cols: number) =>
  Math.min(Math.max(Math.max(title.length, ...lines.map((l) => l.length), 42) + 4, 44), 74, Math.max(24, cols - 6)) + 2;

const approvalPanel = (cmd: string, cols: number): string[] => {
  const title = "⚠️  Dangerous Command", desc = "recursive delete";
  const choices = ["Allow once", "Allow for this session", "Add to permanent allowlist", "Deny"];
  const b: Box = { border: K.border, w: boxWidth(title, [desc, cmd, ...choices.map((c) => `❯ ${c}`)], cols) };
  return [top(b), row(b, K.warn, title, { bold: true }), blank(b),
    ...wrap(cmd, b.w - 2).map((l) => row(b, K.dim, l, { italic: true })), blank(b),
    ...choices.map((c, i) => row(b, i ? K.dim : K.title, `${i ? " " : "❯"} ${i + 1}. ${c}`, { bold: !i })), blank(b),
    ...wrap(desc, b.w - 2).map((l) => row(b, K.text, l, { bold: true })), bottom(b)];
};

const clarifyPanel = (q: string, cols: number): string[] => {
  const title = "Hermes needs your input", header = "1 question", guide = "  Type your answer in the prompt below, then press Enter.";
  const b: Box = { border: K.border, w: boxWidth(title, [header, `▸ ${q}`, guide], cols) };
  return [`${paint(K.border, "╭─ ")}${paint(K.title, title, true)}${paint(K.border, ` ${"─".repeat(Math.max(0, b.w - cells(title) - 3))}╮`)}`,
    row(b, K.text, header, { bold: true }),
    ...wrap(`▸ ${q}`, b.w - 2).map((l) => row(b, K.title, l, { bold: true })),
    ...wrap(guide, b.w - 2).map((l) => row(b, K.title, l, { italic: true })), bottom(b)];
};

/** Live-work dock (cli_subagent_monitor.dock_text): full-width status-bar band, hidden while a modal prompt is open. */
const dock = (v: HermesView, cols: number, rows: number, now: number): string[] => {
  if (!v.subagents.length) return [];
  const width = Math.max(0, cols - 2), budget = Math.max(1, Math.min(4, Math.floor((rows - 10) / 3)));
  const shown = v.subagents.slice(0, budget);
  const lines = [clip(` Subagents · ${v.subagents.length} live · Ctrl+T expand · Ctrl+R collapse`, width)];
  shown.forEach((a) => {
    const act = `${Math.max(0, now - a.start)}s · ${a.tool ? `last: ${a.tool}` : "running"}`;
    lines.push(clip(` ● ${clip(a.goal, Math.max(3, width - cells(act) - 5))} · ${act}`, width));
  });
  if (v.subagents.length > shown.length) lines.push(clip(` +${v.subagents.length - shown.length} more · Ctrl+T all subagents`, width));
  return lines.map((l, i) => {
    const t = ` ${l}`;
    return `\x1b[48;2;${rgb(K.sbBg)}m${i ? fg(K.sbText) : fg(K.title, true)}${t}${" ".repeat(Math.max(0, cols - cells(t)))}${RST}`;
  });
};

/** Composer top rule; while busy it carries the spinner: `── ⠹ activity · 14s · ↓ 547 tok ───`. */
const topRule = (cols: number, busy: boolean, activity: string, extras: string[]) => {
  if (!busy) return paint(K.rule, "─".repeat(cols));
  const tail = extras.map((e) => ` · ${e}`).join("");
  const text = clip(activity, Math.max(1, cols - 8 - cells(tail)));
  const used = 5 + cells(text) + cells(tail) + 1;
  return `${paint(K.rule, "── ")}${paint(K.accent, "⠹ ", true)}${text}${fg(K.sbDim)}${tail}${RST}${paint(K.rule, ` ${"─".repeat(Math.max(0, cols - used))}`)}`;
};

/** Footer under the composer (status_line_fragments): width tiers <52 / <76 / wide, then cwd (branch), then key hints on wide panes. */
const footer = (v: HermesView, cols: number, busy: boolean, modal: boolean, now: number): string => {
  const tier = cols < 52 ? 0 : cols < 76 ? 1 : 2, pct = 12;
  const secs = dur(Math.max(0, now - (v.turnStart ?? v.since)));
  const strong = (t: string) => paint(K.title, t, true), dm = (t: string) => paint(K.sbDim, t);
  const parts: [string, string][] = [[`${fg(K.sbText)} ☤ ${RST}${strong("qwen3:8b")}`, " ☤ qwen3:8b"]];
  if (tier === 2) parts.push([dm("12.3k/32k"), "12.3k/32k"]);
  if (tier) {
    const bar = `[${"█".repeat(1)}${"░".repeat(9)}]`;
    parts.push(tier === 2 ? [`${paint(K.good, bar, true)} ${paint(K.good, `${pct}%`, true)}`, `${bar} ${pct}%`] : [paint(K.good, `${pct}%`, true), `${pct}%`]);
  }
  parts.push([dm(secs), secs]);
  let line = parts.map((p) => p[0]).join(dm(" · ")), plain = parts.map((p) => p[1]).join(" · ");
  let right = "", rightW = 0;
  if (tier === 2 && !modal) {
    const hints: [string, string][] = busy ? [["enter", "interrupt"], ["tab", "queue"], ["ctrl+c", "stop"]] : [["/", "commands"], ["@", "files"], ["!", "shell"]];
    right = hints.map(([k, t]) => `${strong(k)}${dm(` ${t}`)}`).join(dm(" · "));
    rightW = hints.reduce((a, [k, t], i) => a + k.length + 1 + t.length + (i ? 3 : 0), 0);
  }
  const room = cols - cells(plain) - rightW - 6;
  if (room >= 12) { // cwd takes what is left, trimmed from the left
    let cwd = `${v.cwd}${v.branch ? ` (${v.branch})` : ""}`;
    if (cells(cwd) > room) cwd = `…${cwd.slice(-(room - 1))}`;
    line += dm(` · ${cwd}`);
    plain += ` · ${cwd}`;
  }
  return line + (right ? " ".repeat(Math.max(1, cols - cells(plain) - rightW - 1)) + right : "");
};

/** Full ANSI screen for one Hermes pane; ends with the cursor on the composer line, right after the prompt glyph. */
export function hermesScreen(v: HermesView, cols: number, rows: number, now = Math.floor(Date.now() / 1000), clear = false): string {
  const modal = v.state === "approval" || v.state === "question";
  const busy = v.state !== "idle" && v.state !== "closed";
  const compact = cols < 64; // _use_minimal_tui_chrome: icon-only prompt, no bottom rule
  const secs = Math.max(0, now - (v.turnStart ?? v.since));
  const lines = transcript(v, cols);
  let activity = "", glyph = "❯", pStyle = fg(K.text), placeholder = "Find and fix a failing test";
  if (v.state === "approval") {
    const cmd = v.pending?.text.replace(/ 실행 허용\?$/, "") ?? "rm -rf build/";
    lines.push(...approvalPanel(cmd, cols), `${ital(K.dim, "  ↑/↓ to select, Enter to confirm")}${paint(K.border, "  (298s)")}`);
    activity = `💻  ${cmd}`; glyph = "⚠"; pStyle = `\x1b[3m${fg(K.dim)}`; placeholder = "";
  } else if (v.state === "question") {
    lines.push(...clarifyPanel(v.pending?.text ?? "", cols), `${ital(K.dim, "  type your answer and press Enter")}${paint(K.border, "  (88s)")}`);
    activity = "❓  clarify"; glyph = "✎"; pStyle = fg(K.title, true); placeholder = "type your answer here and press Enter";
  } else if (busy) {
    activity = v.state === "tool" ? `${v.tool === "terminal" ? "💻" : "⚡"}  ${v.toolDetail || v.tool}` : "(◔_◔) pondering...";
    glyph = "☤"; pStyle = `\x1b[3m${fg(K.dim)}`; placeholder = "type to redirect this turn · Tab queues it for after";
  }
  if (glyph !== "❯") glyph = compact ? `${glyph} ` : `${glyph} ❯ `; else glyph = "❯ ";
  if (!modal) lines.push(...dock(v, cols, rows, now));
  const flow = secs > 0 ? `↓ ${secs < 100 ? secs * 9 : `${((secs * 9) / 1000).toFixed(1)}k`} tok` : "";
  lines.push(topRule(cols, busy, activity, busy ? [dur(secs), flow].filter(Boolean) : []));

  const ph = clip(placeholder, Math.max(0, cols - cells(glyph) - 1));
  // pad the composer row with real spaces so the focus band (an xterm decoration) spans the full width
  const composer = `${pStyle}${glyph}${RST}${ph ? ital(K.dim, ph) : ""}${" ".repeat(Math.max(0, cols - 1 - cells(glyph) - cells(ph)))}`;
  const tail = [...(compact ? [] : [paint(K.rule, "─".repeat(cols))]), footer(v, cols, busy, modal, now)];
  return (clear ? "\x1b[2J\x1b[3J\x1b[H" : "") + [...lines, composer].join("\r\n") + tail.map((l) => `\r\n${l}`).join("") + `\x1b[${tail.length}A\x1b[${cells(glyph) + 1}G`;
}
