import { expect, test } from "vitest";
import { maxColsFor, movePane, placements, reconcile, type Layout } from "./grid";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

test("maxColsFor", () => {
  expect(maxColsFor(0)).toBe(1);
  expect(maxColsFor(379)).toBe(1);
  expect(maxColsFor(1580)).toBe(4);
  expect(maxColsFor(1139)).toBe(2);
  expect(maxColsFor(1140)).toBe(3);
  expect(maxColsFor(900, 300)).toBe(3);
});

test("reconcile: fresh panes go columns first, then stack on the shortest column", () => {
  expect(reconcile([], ids(1), 3)).toEqual([["p1"]]);
  expect(reconcile([], ids(3), 3)).toEqual([["p1"], ["p2"], ["p3"]]);
  expect(reconcile([], ids(4), 3)).toEqual([["p1"], ["p2"], ["p3", "p4"]]);
  expect(reconcile([], ids(5), 3)).toEqual([["p1"], ["p2", "p5"], ["p3", "p4"]]);
  expect(reconcile([], ids(4), 4)).toEqual([["p1"], ["p2"], ["p3"], ["p4"]]);
  expect(reconcile([], ids(5), 4)).toEqual([["p1"], ["p2"], ["p3"], ["p4", "p5"]]);
});

test("reconcile: close drops ids and empty columns, add appends, unchanged is stable", () => {
  const l: Layout = [["p1"], ["p2", "p4"], ["p3"]];
  expect(reconcile(l, ["p1", "p2", "p4"], 3)).toEqual([["p1"], ["p2", "p4"]]);
  expect(reconcile(l, ids(5), 3)).toEqual([["p1"], ["p2", "p4"], ["p3", "p5"]]);
  expect(reconcile([["p1"], ["p2"]], ids(3), 3)).toEqual([["p1"], ["p2"], ["p3"]]);
  expect(reconcile(l, ids(4), 3)).toBe(l);
  expect(reconcile(l, ["p4", "p3", "p2", "p1"], 1)).toBe(l); // never merges existing columns
});

test("movePane: four sides", () => {
  const l: Layout = [["a"], ["b", "c"], ["d"]];
  expect(movePane(l, "d", { id: "a", side: "left" })).toEqual([["d"], ["a"], ["b", "c"]]);
  expect(movePane(l, "a", { id: "d", side: "right" })).toEqual([["b", "c"], ["d"], ["a"]]);
  expect(movePane(l, "d", { id: "b", side: "top" })).toEqual([["a"], ["d", "b", "c"]]);
  expect(movePane(l, "a", { id: "c", side: "bottom" })).toEqual([["b", "c", "a"], ["d"]]);
});

test("movePane: self drop, no-op positions, same column, emptying a column", () => {
  const l: Layout = [["a"], ["b", "c"], ["d"]];
  expect(movePane(l, "b", { id: "b", side: "left" })).toBe(l);
  expect(movePane(l, "a", { id: "b", side: "left" })).toBe(l);
  expect(movePane(l, "d", { id: "b", side: "right" })).toBe(l);
  expect(movePane(l, "b", { id: "c", side: "top" })).toBe(l);
  expect(movePane(l, "c", { id: "b", side: "bottom" })).toBe(l);
  expect(movePane(l, "b", { id: "c", side: "bottom" })).toEqual([["a"], ["c", "b"], ["d"]]);
  expect(movePane(l, "zz", { id: "a", side: "left" })).toBe(l);
  expect(movePane(l, "a", { id: "zz", side: "left" })).toBe(l);
  expect(movePane([["a"], ["b"]], "a", { id: "b", side: "bottom" })).toEqual([["b", "a"]]);
});

test("placements", () => {
  expect(placements([])).toEqual({ cols: 0, rows: 0, cells: {} });
  expect(placements([["a"]])).toEqual({ cols: 1, rows: 1, cells: { a: { col: 0, row: 0, rowSpan: 1 } } });
  expect(placements([["a", "b"], ["c"]])).toEqual({ cols: 2, rows: 2, cells: { a: { col: 0, row: 0, rowSpan: 1 }, b: { col: 0, row: 1, rowSpan: 1 }, c: { col: 1, row: 0, rowSpan: 2 } } });
  const p = placements([["a", "b"], ["c", "d", "e"]]);
  expect(p.rows).toBe(6);
  expect(p.cells).toEqual({
    a: { col: 0, row: 0, rowSpan: 3 }, b: { col: 0, row: 3, rowSpan: 3 },
    c: { col: 1, row: 0, rowSpan: 2 }, d: { col: 1, row: 2, rowSpan: 2 }, e: { col: 1, row: 4, rowSpan: 2 },
  });
});
