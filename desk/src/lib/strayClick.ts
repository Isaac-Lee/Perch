// WKWebView with an input method active (Korean, ...) and a text field focused can lose a button's first click in two ways:
// the click goes to the focused field wherever the pointer is, or the release arrives before the press (no click at all).

type Field = { tagName: string; getBoundingClientRect(): { left: number; right: number; top: number; bottom: number } };
type Hit = { closest(sel: string): unknown } | null;
const BUTTON = "button:not(:disabled)";

/** For a click on a text field that landed outside its box: the button under the pointer. */
export function strayClickButton(target: unknown, x: number, y: number, at: (x: number, y: number) => Hit): unknown {
  const t = target as Field | null;
  if (!t || (t.tagName !== "TEXTAREA" && t.tagName !== "INPUT")) return null;
  const r = t.getBoundingClientRect();
  if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return null;
  return at(x, y)?.closest(BUTTON) ?? null;
}

/** Tracks press/release order. `down` is true for a press whose release already came (same spot, within 1 s): it gets no click. */
export function pressOrder() {
  let pressed = false, orphan: { x: number; y: number; t: number } | null = null;
  return {
    down(x: number, y: number, t: number): boolean {
      const lost = !!orphan && orphan.x === x && orphan.y === y && t - orphan.t < 1000;
      orphan = null;
      pressed = !lost;
      return lost;
    },
    up(x: number, y: number, t: number): void {
      if (!pressed) orphan = { x, y, t };
      pressed = false;
    },
  };
}

/** Installs both repairs on `doc`. */
export function installClickRepair(doc: Document): void {
  doc.addEventListener("click", (e) => {
    if (e.detail === 0) return;
    const b = strayClickButton(e.target, e.clientX, e.clientY, (x, y) => doc.elementFromPoint(x, y));
    if (b instanceof HTMLButtonElement) b.click();
  }, true);
  const order = pressOrder();
  doc.addEventListener("mouseup", (e) => { if (e.button === 0) order.up(e.clientX, e.clientY, e.timeStamp); }, true);
  doc.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || !order.down(e.clientX, e.clientY, e.timeStamp)) return;
    const b = (e.target as Element | null)?.closest?.(BUTTON);
    if (b instanceof HTMLButtonElement) setTimeout(() => b.click()); // after this press's own handlers
  }, true);
}
