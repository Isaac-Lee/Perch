export interface Cell { col: number; row: number; colSpan: number }

export function gridLayout(n: number): { cols: number; rows: number; cells: Cell[] } {
  if (n <= 0) return { cols: 0, rows: 0, cells: [] };
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const cells: Cell[] = [];
  for (let r = 0; r < rows; r++) {
    const inRow = r === rows - 1 ? n - cols * (rows - 1) : cols;
    // spread cols evenly over this row's cells; the remainder goes to the last cell
    const base = Math.floor(cols / inRow);
    const extra = cols - base * inRow;
    let col = 0;
    for (let i = 0; i < inRow; i++) {
      const colSpan = i === inRow - 1 ? base + extra : base;
      cells.push({ col, row: r, colSpan });
      col += colSpan;
    }
  }
  return { cols, rows, cells };
}
