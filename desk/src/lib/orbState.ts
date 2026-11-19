import type { OrbState } from "thinking-orbs";

export type Activity = { orb: OrbState; label: string };

export function activityOf(state: "running" | "thinking" | "tool", tool: string): Activity {
  if (state === "thinking") return { orb: "breathing", label: "Thinking" };
  const t = tool.toLowerCase();
  if (state === "running" || !t) return { orb: "composing", label: "Writing" };
  if (/^mcp__?/.test(t)) return { orb: "connecting", label: "Connecting" };
  if (/^(agent|task|subagent)$|^delegate/.test(t)) return { orb: "weaving", label: "Delegating" };
  if (/todo/.test(t)) return { orb: "solving", label: "Working" };
  if (/^(edit|write|multiedit|notebookedit|patch|create)|^write_file/.test(t)) return { orb: "shaping", label: "Editing" };
  if (/^(read|grep|glob|search|web|fetch|browser|list)/.test(t)) return { orb: "searching", label: "Searching" };
  if (/^(bash|powershell|terminal|shell|execute|run)/.test(t)) return { orb: "working", label: "Running" };
  return { orb: "solving", label: "Working" };
}
