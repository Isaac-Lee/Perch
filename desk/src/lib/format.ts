import type { SessionStateName } from "./types";

export function fmtElapsed(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

const LABELS: Record<SessionStateName | "stale", string> = {
  running: "Working", thinking: "Thinking", tool: "Running", approval: "Needs approval",
  question: "Question", idle: "Waiting", plain: "", closed: "Closed", stale: "Not responding",
};

export function stateLabel(s: SessionStateName | "stale"): string {
  return LABELS[s];
}
