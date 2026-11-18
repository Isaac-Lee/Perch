import { describe, expect, it } from "vitest";
import { kvRows, resultCount, resultView, thoughtTitle, toolTitle } from "./toolView";

const tool = (o: object) => ({ kind: "tool" as const, id: "1", name: "x", context: "", status: "done" as const, ...o });

describe("toolView", () => {
  it("thoughtTitle: first line without markdown, capped", () => {
    expect(thoughtTitle("**Using terminal commands**\n\nI need")).toBe("Using terminal commands");
    expect(thoughtTitle("\n\n# Hello `x`")).toBe("Hello x");
    expect(thoughtTitle("")).toBe("");
    expect(thoughtTitle("a".repeat(100))).toHaveLength(60);
  });
  it("kvRows skips empties, cuts long strings, stringifies objects", () => {
    expect(kvRows({ a: "x", b: "", c: null, d: [], e: { k: 1 }, f: "y".repeat(400) })).toEqual([["a", "x"], ["e", '{"k":1}'], ["f", "y".repeat(299) + "…"]]);
    expect(kvRows("str")).toEqual([]);
  });
  it("resultView: object rows, output as text, resultText wins, raw fallback", () => {
    expect(resultView('{"name":"n","tags":["a"]}')).toEqual({ rows: [["name", "n"], ["tags", '["a"]']], text: "" });
    expect(resultView('{"output":"hi","exit_code":0}')).toEqual({ rows: [["exit_code", "0"]], text: "hi" });
    expect(resultView("plain")).toEqual({ rows: [], text: "plain" });
    expect(resultView("[1]")).toEqual({ rows: [], text: "[1]" });
    expect(resultView("{}", "rt")).toEqual({ rows: [], text: "rt" });
  });
  it("resultCount follows the desktop precedence", () => {
    expect(resultCount('{"count":16,"skills":[1]}')).toBe(16);
    expect(resultCount('{"results":[1,2,3]}')).toBe(3);
    expect(resultCount('{"data":{"total":5}}')).toBe(5);
    expect(resultCount('{"hit_count":2}')).toBe(2);
    expect(resultCount('{"success":true}')).toBeNull();
    expect(resultCount("nope")).toBeNull();
  });
  it("toolTitle: skills, labels, terminal, fallback", () => {
    expect(toolTitle(tool({ name: "skill_view", args: { name: "hermes-agent" } }))).toBe("스킬 불러옴: hermes-agent");
    expect(toolTitle(tool({ name: "skill_view", args: { name: "a", file_path: "f.md" } }))).toBe("스킬 자료 읽음: a → f.md");
    expect(toolTitle(tool({ name: "skill_view", args: {}, status: "running" }))).toBe("스킬 불러오는 중");
    expect(toolTitle(tool({ name: "mcp", labels: ["Gmail · search"] }))).toBe("Gmail · search");
    expect(toolTitle(tool({ name: "terminal", args: { command: "ls -la\nmore" } }))).toBe("실행: ls -la");
    expect(toolTitle(tool({ name: "weird", context: "c" }))).toBe("weird · c");
    expect(toolTitle(tool({ name: "weird", preview: "p" }))).toBe("weird · p");
  });
});
