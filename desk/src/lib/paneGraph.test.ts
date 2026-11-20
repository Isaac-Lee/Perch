import { describe, expect, it } from "vitest";
import type { SubagentLive } from "./chatSession";
import { getGraphOpen, getPaneGraph, graphRows, layoutGraph, openGraph, closeGraph, runningCount, setPaneGraph, toggleGraph } from "./paneGraph";

const sa = (id: string, index: number, delegationId?: string, status: SubagentLive["status"] = "running"): SubagentLive => ({ id, index, count: 3, delegationId, goal: id, model: "m", status, tool: "", toolPreview: "", toolCount: 0, startAt: null });
const bg = (taskId: string, status: "running" | "done" = "running") => ({ taskId, text: taskId, status });
const root = { title: "t", label: "Working" };

/** end point of a path made of M/H/V/Q */
function trace(d: string) {
  let x = 0, y = 0, first: [number, number] = [0, 0];
  for (const m of d.matchAll(/([MHVQ])([^MHVQ]*)/g)) {
    const n = m[2].trim().split(/\s+/).map(Number);
    if (m[1] === "M") { x = n[0]; y = n[1]; first = [x, y]; }
    else if (m[1] === "H") x = n[0];
    else if (m[1] === "V") y = n[0];
    else { x = n[2]; y = n[3]; }
  }
  return { first, end: [x, y] };
}

describe("graphRows", () => {
  it("groups by delegation in first-seen order, sorts by index, then background", () => {
    const rows = graphRows(root, [sa("a2", 1, "d1"), sa("b1", 0, "d2"), sa("a1", 0, "d1"), sa("x", 0)], [bg("t1")]);
    expect(rows.map((r) => r.map((n) => n.id))).toEqual([["root"], ["a1", "a2"], ["b1"], ["x"], ["t1"]]);
  });
  it("has no extra rows when empty", () => expect(graphRows(root, [], [])).toHaveLength(1));
});

describe("layoutGraph", () => {
  const rows = graphRows(root, [sa("a", 0, "d1"), sa("b", 1, "d1"), sa("c", 2, "d1"), sa("e", 0, "d2")], [bg("t")]);
  it("counts nodes and edges", () => {
    const l = layoutGraph(rows, 760);
    expect(l.nodes).toHaveLength(6);
    expect(l.edges).toHaveLength(5);
  });
  it("wraps at narrow width and centers each line", () => {
    const l = layoutGraph(graphRows(root, ["a", "b", "c", "e", "f"].map((id, i) => sa(id, i, "d")), []), 360);
    const ys = new Set(l.nodes.filter((n) => n.id !== "root").map((n) => n.y));
    expect(ys.size).toBe(3); // 2 per line at 360
    const w = layoutGraph(graphRows(root, [sa("a", 0, "d"), sa("b", 1, "d")], []), 600);
    const [a, b] = w.nodes.slice(1);
    expect(a.y).toBe(b.y);
    expect(a.x + (b.x + b.w - a.x) / 2).toBe(300);
  });
  it("edges go from root bottom-center to child top-center with only H/V and curves", () => {
    for (const width of [320, 760]) {
      const l = layoutGraph(rows, width), r = l.nodes[0];
      for (const e of l.edges) {
        const n = l.nodes.find((x) => x.id === e.id)!, t = trace(e.d);
        expect(e.d).toMatch(/^[MHVQ0-9. \-]+$/);
        expect(t.first).toEqual([r.x + r.w / 2, r.y + r.h]);
        expect(t.end).toEqual([n.x + n.w / 2, n.y]);
      }
    }
  });
  it("draws a straight line for a centered child", () => {
    const l = layoutGraph(graphRows(root, [sa("a", 0, "d")], []), 400);
    expect(l.edges[0].d).toBe("M200 72V112");
  });
});

describe("runningCount", () => {
  it("counts starting/running subagents and running background", () => {
    expect(runningCount({ subagents: [sa("a", 0, "d", "starting"), sa("b", 1, "d", "done"), sa("c", 2, "d")], background: [bg("t"), bg("u", "done")] })).toBe(3);
  });
});

describe("store", () => {
  it("publishes, skips no-op, clears on empty; toggles open", () => {
    const d = { subagents: [sa("a", 0)], background: [] };
    setPaneGraph("p", d);
    const before = getPaneGraph();
    setPaneGraph("p", { ...d });
    expect(getPaneGraph()).toBe(before);
    setPaneGraph("p", { subagents: [], background: [] });
    expect(getPaneGraph().has("p")).toBe(false);
    toggleGraph("p"); expect(getGraphOpen().has("p")).toBe(true);
    openGraph("p"); closeGraph("p"); expect(getGraphOpen().has("p")).toBe(false);
  });
});
