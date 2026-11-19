import { expect, test } from "vitest";
import { activityOf } from "./orbState";

const orb = (tool: string) => activityOf("tool", tool).orb;
const cases: [string, string[]][] = [
  ["connecting", ["mcp__srv__x", "mcp_foo"]],
  ["weaving", ["Agent", "Task", "delegate_task", "subagent"]],
  ["shaping", ["Edit", "Write", "MultiEdit", "NotebookEdit", "write_file", "patch", "create_file"]],
  ["searching", ["Read", "Grep", "Glob", "WebSearch", "WebFetch", "read_file", "search_files", "web_search", "web_extract", "browser_click", "list_dir"]],
  ["working", ["Bash", "PowerShell", "terminal", "execute_code", "run_tests"]],
  ["solving", ["TodoWrite", "Whatever"]],
];
test("tool classification", () => {
  for (const [o, names] of cases) for (const n of names) expect(orb(n), n).toBe(o);
});
test("labels and fallbacks", () => {
  expect(activityOf("thinking", "Read")).toEqual({ orb: "breathing", label: "Thinking" });
  expect(activityOf("running", "Read")).toEqual({ orb: "composing", label: "Writing" });
  expect(activityOf("tool", "")).toEqual({ orb: "composing", label: "Writing" });
  expect(activityOf("tool", "write_file").label).toBe("Editing");
  expect(activityOf("tool", "read_file").label).toBe("Searching");
  expect(activityOf("tool", "Bash").label).toBe("Running");
  expect(activityOf("tool", "TaskCreate")).toEqual({ orb: "solving", label: "Working" });
  expect(activityOf("tool", "TaskUpdate")).toEqual({ orb: "solving", label: "Working" });
  expect(orb("Task")).toBe("weaving");
  expect(orb("Agent")).toBe("weaving");
});
