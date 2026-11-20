export type AgentKind = "hermes" | "opencode" | "shell";
export type SessionStateName = "running" | "thinking" | "tool" | "approval" | "question" | "idle" | "plain" | "closed";
export interface Subagent { id: string; role: string; goal: string; start: number; tool?: string }
export interface Todo { text: string; status: "pending" | "in_progress" | "done" }
export interface Pending { kind: "approval" | "question"; id: string; text: string }
export interface Usage { model: string; input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number; apiCalls: number; costUsd: number | null; startedAt: number }
export interface Session {
  agent: AgentKind; sessionId: string; cwd: string; repoRoot: string | null; branch: string | null;
  state: SessionStateName; since: number; turnStart: number | null; lastTurn?: number | null; steps: number;
  tool: string; toolDetail: string; prompt: string; title?: string; pending: Pending | null;
  /** the last reply ended with a question (heuristic); `ask` is its one-line preview */
  asks?: boolean; ask?: string;
  subagents: Subagent[]; todos: Todo[]; seen: number; paneId: string | null; usage: Usage | null;
  /** `bg_*` background run: the session that started it (backend match by PERCH_PANE) */ parentId?: string | null;
}
export type PaneView = "chat" | "tui";
export interface Pane { id: string; agent: AgentKind; cwd: string; sessionId: string | null; title: string; branch: string | null; view?: PaneView } // optional: mock panes (src/mock) never set it
export interface Group { key: string; path: string; label: string; isCommon: boolean; sessions: Session[]; recent: Session[] }
