import { expect, it } from "vitest";
import { getBackgroundTasks, setBackgroundTasks } from "./liveBackground";

it("publishes per pane, skips no-ops, replaces and clears", () => {
  setBackgroundTasks("p1", ["bg_a"]);
  setBackgroundTasks("p2", ["bg_b"]);
  const before = getBackgroundTasks();
  setBackgroundTasks("p1", ["bg_a"]);
  expect(getBackgroundTasks()).toBe(before);
  expect(Object.fromEntries(before)).toEqual({ bg_a: "p1", bg_b: "p2" });
  setBackgroundTasks("p1", ["bg_c"]);
  expect(Object.fromEntries(getBackgroundTasks())).toEqual({ bg_c: "p1", bg_b: "p2" });
  setBackgroundTasks("p1", []);
  setBackgroundTasks("p2", []);
  expect(getBackgroundTasks().size).toBe(0);
});
