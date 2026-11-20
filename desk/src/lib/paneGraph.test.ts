import { describe, expect, it } from "vitest";
import type { SubagentLive } from "./chatSession";
import { getGraphOpen, getPaneGraph, graphRows, layoutGraph, GAP, INDENT, PAD, ROW_GAP, openGraph, closeGraph, runningCount, setPaneGraph, toggleGraph } from "./paneGraph";

const sa = (id: string, index: number, delegationId?: string, status: SubagentLive["status"] = "running"): SubagentLive => ({ id, index, count: 3, delegationId, goal: id, model: "m", status, tool: "", toolPreview: "", toolCount: 0, depth: 0, startAt: null });
const kid = (id: string, parentId: string, depth: number, index = 0, delegationId = "n"): SubagentLive => ({ ...sa(id, index, delegationId), parentId, depth });
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

const ids = (l: { id: string }[]) => l.map((n) => n.id);

describe("graphRows", () => {
  it("is depth-first: delegation groups in first-seen order, descendants right after their parent, background last", () => {
    const subs = [sa("a2", 1, "d1"), sa("b1", 0, "d2"), sa("a1", 0, "d1"), sa("x", 0), kid("a1a", "a1", 1), kid("a1a1", "a1a", 2), kid("a2a", "a2", 1)];
    const rows = graphRows(root, subs, [bg("t1")]);
    expect(ids(rows)).toEqual(["root", "a1", "a1a", "a1a1", "a2", "a2a", "b1", "x", "t1"]);
    expect(rows.map((n) => n.level)).toEqual([0, 1, 2, 3, 1, 2, 1, 1, 1]);
    expect(rows.find((n) => n.id === "a1a1")!.parentId).toBe("a1a");
    expect(rows.find((n) => n.id === "t1")!.parentId).toBe("root");
    expect(rows.filter((n) => n.gap).map((n) => n.id)).toEqual(["a1", "b1", "x", "t1"]);
  });
  it("has only root when empty; unknown parent is top-level", () => {
    expect(graphRows(root, [], [])).toHaveLength(1);
    expect(ids(graphRows(root, [kid("o", "ghost", 1)], []))).toEqual(["root", "o"]);
  });
});

describe("layoutGraph", () => {
  const subs = [sa("a", 0, "d1"), sa("b", 1, "d1"), kid("a1", "a", 1), kid("a11", "a1", 2), sa("c", 0, "d2")];
  const list = graphRows(root, subs, [bg("t")]);
  const l = layoutGraph(list, 500), at = (id: string) => l.nodes.find((n) => n.id === id)!;
  it("one node per line, indented per level", () => {
    expect(ids(l.nodes)).toEqual(ids(list));
    list.forEach((n) => expect(at(n.id).x).toBe(PAD + n.level * INDENT));
    for (let i = 1; i < l.nodes.length; i++) expect(l.nodes[i].y).toBeGreaterThan(l.nodes[i - 1].y + l.nodes[i - 1].h);
    expect(at("root").h).toBe(56);
    expect(at("a").w).toBe(280);
  });
  it("adds extra gap before a new group and before background", () => {
    const g = (p: string, q: string) => at(q).y - (at(p).y + at(p).h);
    expect(g("root", "a")).toBe(GAP + 8);
    expect(g("a11", "b")).toBe(GAP); // same delegation
    expect(g("b", "c")).toBe(GAP + 8);
    expect(g("c", "t")).toBe(GAP + 8);
  });
  it("edges run from parent trunk (x+12, bottom) to the child's left edge at vertical center, depth 2 included", () => {
    expect(l.edges).toHaveLength(list.length - 1);
    for (const e of l.edges) {
      const n = list.find((x) => x.id === e.id)!, c = at(e.id), p = at(n.parentId!), t = trace(e.d);
      expect(e.d).toMatch(/^[MHVQ0-9. \-]+$/);
      expect(t.first).toEqual([p.x + 12, p.y + p.h]);
      expect(t.end).toEqual([c.x, c.y + c.h / 2]);
    }
    expect(list.find((n) => n.id === "a11")!.level).toBe(3);
  });
  it("keeps min width and widens the canvas when narrow", () => {
    const s = layoutGraph(list, 200);
    expect(s.nodes.every((n) => n.w >= 160)).toBe(true);
    expect(s.width).toBeGreaterThan(200);
  });
});

describe("layoutGraph horizontal", () => {
  const list = graphRows(root, [sa("a", 0, "d1"), sa("b", 1, "d1"), kid("a1", "a", 1), kid("a11", "a1", 2), sa("c", 0, "d2"), sa("c1", 0, "d2")].map((x) => (x.id === "c1" ? kid("c1", "c", 1, 0, "d2") : x)), [bg("t")]);
  const l = layoutGraph(list, 400, "horizontal"), at = (id: string) => l.nodes.find((n) => n.id === id)!;
  it("level-1 siblings are consecutive even with children; children start under their parent; rows never overlap", () => {
    const lvl1 = list.filter((n) => n.level === 1).map((n) => at(n.id));
    expect(lvl1.map((n) => n.x)).toEqual([PAD, PAD + 216, PAD + 2 * 216 + 8, PAD + 3 * 216 + 16]); // a, b, c, t: +8 where d2 and background start
    for (const n of list) if (n.parentId) expect(at(n.id).x).toBeGreaterThanOrEqual(at(n.parentId).x);
    expect(at("a1").x).toBe(at("a").x);
    expect(at("a11").x).toBe(at("a1").x);
    expect(at("root").x).toBe(PAD);
    for (const lv of [0, 1, 2, 3]) {
      const row = list.filter((n) => n.level === lv).map((n) => at(n.id)).sort((p, q) => p.x - q.x);
      for (let i = 1; i < row.length; i++) expect(row[i].x).toBeGreaterThanOrEqual(row[i - 1].x + row[i - 1].w);
    }
    list.forEach((n) => expect(at(n.id).y).toBe(PAD + n.level * (72 + ROW_GAP)));
  });
  it("edges drop from parent bottom (x+16) onto child top (x+16)", () => {
    expect(l.edges).toHaveLength(list.length - 1);
    for (const e of l.edges) {
      const c = at(e.id), p = at(list.find((x) => x.id === e.id)!.parentId!), t = trace(e.d);
      expect(t.first).toEqual([p.x + 16, p.y + p.h]);
      expect(t.end).toEqual([c.x + 16, c.y]);
    }
  });
  it("staggers the horizontal segments of parents sharing a child row", () => {
    const L = layoutGraph(graphRows(root, [sa("a", 0, "d1"), sa("b", 1, "d1"), kid("a1", "a", 1), kid("a2", "a", 1, 1), kid("b1", "b", 1)], []), 900, "horizontal");
    const n = (id: string) => L.nodes.find((x) => x.id === id)!, ys = ["a2", "b1"].map((id) => ({ id, ...trace(L.edges.find((e) => e.id === id)!.d) }));
    const seg = (d: string) => Number(d.match(/V(\d+(?:\.\d+)?)/)![1]);
    const [ya, yb] = ["a2", "b1"].map((id) => seg(L.edges.find((e) => e.id === id)!.d));
    expect(ya).not.toBe(yb);
    for (const { id, end } of ys) expect(end).toEqual([n(id).x + 16, n(id).y]);
  });
  it("sizes the canvas to its extents", () => {
    const r = at("t");
    expect(l.width).toBe(Math.max(400, r.x + r.w + PAD));
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
