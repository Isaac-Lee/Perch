import { describe, expect, it } from "vitest";
import { getLiveSubagents, setLiveSubagents } from "./liveSubagents";

describe("liveSubagents", () => {
  it("publishes, skips no-op updates, and clears", () => {
    const a = { id: "1", role: "", goal: "g", start: 1 };
    setLiveSubagents("p", [a]);
    expect(getLiveSubagents().get("p")).toEqual([a]);
    const before = getLiveSubagents();
    setLiveSubagents("p", [{ ...a }]);
    expect(getLiveSubagents()).toBe(before);
    setLiveSubagents("p", []);
    expect(getLiveSubagents().has("p")).toBe(false);
    setLiveSubagents("p", []); // clearing twice is harmless
  });
});
