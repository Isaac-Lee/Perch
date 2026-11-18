import type { DisplayState } from "./groups";

export function fmtElapsed(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

const LABELS: Record<DisplayState | "idle", string> = {
  running: "Working", thinking: "Thinking", tool: "Running", approval: "Needs approval",
  question: "Question", reply: "Reply needed", idle: "Waiting", done: "Done", ready: "", plain: "", closed: "Closed", stale: "Not responding",
};

export function stateLabel(s: DisplayState): string {
  return LABELS[s];
}
