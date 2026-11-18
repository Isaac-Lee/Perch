import { expect, test } from "vitest";
import { fmtElapsed, stateLabel } from "./format";

test("fmtElapsed", () => {
  expect(fmtElapsed(8)).toBe("8s");
  expect(fmtElapsed(248)).toBe("4m 8s");
  expect(fmtElapsed(3725)).toBe("1h 2m");
  expect(fmtElapsed(-5)).toBe("0s");
});

test("stateLabel", () => {
  const want = {
    running: "Working", thinking: "Thinking", tool: "Running", approval: "Needs approval",
    question: "Question", reply: "Reply needed", done: "Done", ready: "", closed: "Closed", stale: "Not responding",
  } as const;
  for (const [k, v] of Object.entries(want)) expect(stateLabel(k as keyof typeof want)).toBe(v);
});
