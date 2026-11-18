/** Columns of pane ids, left to right; ids inside a column run top to bottom. */
export type Layout = string[][];
export type Side = "left" | "right" | "top" | "bottom";
export interface DropTarget { id: string; side: Side }
export interface Placement { col: number; row: number; rowSpan: number }

// ponytail: tuning knob - narrowest a column may get before new panes stack instead of adding a column (380 fits 4 columns in a 1600px stage)
export const MIN_COL_WIDTH = 380;
export const maxColsFor = (width: number, min = MIN_COL_WIDTH) => Math.max(1, Math.floor(width / min));

const same = (a: Layout, b: Layout) => a.length === b.length && a.every((c, i) => c.length === b[i].length && c.every((id, j) => id === b[i][j]));

/** Drop vanished ids and empty columns; place new ids as a new rightmost column while there is room,
 *  else on the column with the fewest panes (rightmost on ties). Existing columns are never merged. */
export function reconcile(layout: Layout, paneIds: string[], maxCols: number): Layout {
  const want = new Set(paneIds), seen = new Set<string>();
  const out = layout.map((c) => c.filter((id) => want.has(id) && !seen.has(id) && !!seen.add(id))).filter((c) => c.length);
  for (const id of paneIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (out.length < maxCols) { out.push([id]); continue; }
    let best = 0;
    out.forEach((c, i) => { if (c.length <= out[best].length) best = i; });
    out[best].push(id);
  }
  return same(out, layout) ? layout : out;
}

/** Move `id` next to the target pane: new column left/right of it, or above/below it in its column.
 *  A no-op (self drop, already there) returns the same layout object. */
export function movePane(layout: Layout, id: string, target: DropTarget): Layout {
  if (target.id === id || !layout.some((c) => c.includes(id)) || !layout.some((c) => c.includes(target.id))) return layout;
  const cols = layout.map((c) => c.filter((x) => x !== id));
  const ci = cols.findIndex((c) => c.includes(target.id));
  const { side } = target;
  if (side === "left") cols.splice(ci, 0, [id]);
  else if (side === "right") cols.splice(ci + 1, 0, [id]);
  else cols[ci].splice(cols[ci].indexOf(target.id) + (side === "bottom" ? 1 : 0), 0, id);
  const out = cols.filter((c) => c.length);
  return same(out, layout) ? layout : out;
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** CSS grid placement (0-based) without changing the DOM: rows = lcm of column lengths. */
export function placements(layout: Layout): { cols: number; rows: number; cells: Record<string, Placement> } {
  const rows = layout.reduce((l, c) => (l * c.length) / gcd(l, c.length), 1);
  const cells: Record<string, Placement> = {};
  layout.forEach((c, col) => c.forEach((id, i) => { const rowSpan = rows / c.length; cells[id] = { col, row: i * rowSpan, rowSpan }; }));
  return { cols: layout.length, rows: layout.length ? rows : 0, cells };
}
