export type AgentKind = "hermes" | "opencode" | "shell";
export type SessionStateName = "running" | "thinking" | "tool" | "approval" | "question" | "idle" | "closed";
export interface Subagent { id: string; role: string; goal: string; start: number; tool?: string }
export interface Todo { text: string; status: "pending" | "in_progress" | "done" }
export interface Pending { kind: "approval" | "question"; id: string; text: string }
export interface Session {
  agent: AgentKind; sessionId: string; cwd: string; repoRoot: string | null;
  state: SessionStateName; since: number; turnStart: number | null; steps: number;
  tool: string; toolDetail: string; prompt: string; pending: Pending | null;
  subagents: Subagent[]; todos: Todo[]; seen: number; paneId: string | null;
}
export interface Pane { id: string; agent: AgentKind; cwd: string; sessionId: string | null; title: string }
export interface Group { key: string; label: string; isCommon: boolean; sessions: Session[]; recent: Session[] }
