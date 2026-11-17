import { expect, test } from "vitest";
import { gridLayout } from "./grid";

test("gridLayout dimensions", () => {
  expect(gridLayout(0)).toEqual({ cols: 0, rows: 0, cells: [] });
  expect(gridLayout(1)).toMatchObject({ cols: 1, rows: 1 });
  expect(gridLayout(2)).toMatchObject({ cols: 2, rows: 1 });
  expect(gridLayout(3)).toMatchObject({ cols: 2, rows: 2 });
  expect(gridLayout(3).cells[2]).toEqual({ col: 0, row: 1, colSpan: 2 });
  expect(gridLayout(4)).toMatchObject({ cols: 2, rows: 2 });
  expect(gridLayout(5)).toMatchObject({ cols: 3, rows: 2 });
  expect(gridLayout(6)).toMatchObject({ cols: 3, rows: 2 });
  expect(gridLayout(8)).toMatchObject({ cols: 3, rows: 3 });
  expect(gridLayout(9)).toMatchObject({ cols: 3, rows: 3 });
  expect(gridLayout(10)).toMatchObject({ cols: 4, rows: 3 });
});

test("gridLayout fills every row and never overlaps", () => {
  for (let n = 1; n <= 16; n++) {
    const { cols, cells } = gridLayout(n);
    expect(cells).toHaveLength(n);
    const rows = new Map<number, { sum: number; end: number }>();
    for (const c of cells) {
      const r = rows.get(c.row) ?? { sum: 0, end: 0 };
      expect(c.col).toBe(r.end);
      r.sum += c.colSpan;
      r.end = c.col + c.colSpan;
      rows.set(c.row, r);
    }
    for (const r of rows.values()) expect(r.sum).toBe(cols);
  }
});
