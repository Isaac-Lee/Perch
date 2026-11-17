import type { AgentKind } from "../lib/types";

const g = (s: string) => `\x1b[32m${s}\x1b[0m`;
const d = (s: string) => `\x1b[90m${s}\x1b[0m`;
const c = (s: string) => `\x1b[36m${s}\x1b[0m`;
const y = (s: string) => `\x1b[33m${s}\x1b[0m`;

const hermes = [
  `${d("☤ qwen3:8b · 4m · ctx 12%")}`, `${c("hermes")} ${d("v0.23.2 · oh-my-hermes · session ready")}`, "",
  `${g("> ")}실패하는 테스트를 고쳐 주세요`, "",
  `${d("●")} read_file  src/app.ts`, `${d("  142 lines")}`,
  `${d("●")} read_file  src/app.test.ts`, `${d("  88 lines")}`,
  `${d("●")} patch      src/app.ts`, `${d("  -    return items.map(parse)")}`, `${d("  +    return items.filter(Boolean).map(parse)")}`,
  `${d("●")} terminal   npm test`, "",
  " RUN  v5.1.0", ` ${g("✓")} src/lib/grid.test.ts (3)`, ` ${g("✓")} src/lib/format.test.ts (2)`,
  ` ${y("✗")} src/app.test.ts (1)`, "   expected 3, received 2", "",
  "원인을 좁히는 중입니다. 서브 작업 2개를 시작했습니다.", "",
];
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
export const terminalPrompt = (agent: AgentKind, cols: number) =>
  agent === "shell" ? d("PS D:\\ysl\\st-alpha> ") + fill(cols - 18) :`${d("─".repeat(Math.max(cols, 1)))}\r\n❯ ${fill(cols)}`;

export const terminalLines: Record<AgentKind, string[]> = { hermes, opencode, shell };
