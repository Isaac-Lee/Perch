import { useEffect, useRef, useState } from "react";

const THRESHOLD = 5, EDGE = 40, MAX_SCROLL = 16;
export interface DragState { id: string; gkey: string; y: number }

/** Pointer-based row reordering (HTML5 DnD does not fire in WebView2 with the native file-drop handler on).
 *  Rows carry `data-sid`, their container `.group` carries `data-gkey`. A press that never moves past the
 *  threshold is left alone so it stays a normal click. */
export function useRowDrag(enabled: boolean, bodyRef: React.RefObject<HTMLElement | null>, commit: (gkey: string, id: string, to: number) => void) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const suppressClick = useRef(false);
  const teardown = useRef<(() => void) | null>(null);
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => () => teardown.current?.(), []);

  const onPointerDown = (e: React.PointerEvent<HTMLElement>, id: string) => {
    if (!enabled || e.button !== 0 || (e.target as Element).closest("button")) return;
    const row = e.currentTarget, groupEl = row.closest<HTMLElement>(".group");
    if (!groupEl) return;
    const gkey = groupEl.dataset.gkey ?? "", pid = e.pointerId, y0 = e.clientY;
    let y = y0, started = false, aborted = false, from = 0, slot = 0, raf = 0;
    const rows = () => [...groupEl.querySelectorAll<HTMLElement>("[data-sid]")];
    const update = () => {
      const rs = rows();
      slot = rs.filter((r) => { const b = r.getBoundingClientRect(); return y > b.top + b.height / 2; }).length;
      const edge = slot < rs.length ? rs[slot].getBoundingClientRect().top : rs[rs.length - 1].getBoundingClientRect().bottom;
      setDrag({ id, gkey, y: edge - groupEl.getBoundingClientRect().top });
    };
    const tick = () => {
      const body = bodyRef.current;
      if (body) {
        const r = body.getBoundingClientRect();
        const d = y < r.top + EDGE ? y - (r.top + EDGE) : y > r.bottom - EDGE ? y - (r.bottom - EDGE) : 0;
        if (d) { body.scrollTop += Math.max(-MAX_SCROLL, Math.min(MAX_SCROLL, d / 3)); update(); }
      }
      raf = requestAnimationFrame(tick);
    };
    const move = (m: PointerEvent) => {
      y = m.clientY;
      if (aborted) return;
      if (!started) {
        if (Math.abs(y - y0) <= THRESHOLD) return;
        started = true;
        from = rows().indexOf(row);
        try { row.setPointerCapture(pid); } catch { /* pointer already gone */ }
        document.body.classList.add("row-dragging");
        raf = requestAnimationFrame(tick);
      }
      update();
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
      cancelAnimationFrame(raf);
      document.body.classList.remove("row-dragging");
      try { row.releasePointerCapture(pid); } catch { /* not captured */ }
      setDrag(null);
      teardown.current = null;
    };
    const finish = (ok: boolean) => {
      stop();
      if (!started) return;
      suppressClick.current = true; // the click that follows pointerup must not focus the session
      setTimeout(() => { suppressClick.current = false; }, 0);
      const to = slot > from ? slot - 1 : slot;
      if (ok && !aborted && to !== from) commitRef.current(gkey, id, to);
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    const key = (k: KeyboardEvent) => { if (k.key === "Escape" && started) { aborted = true; cancelAnimationFrame(raf); setDrag(null); } };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key);
    teardown.current = stop;
  };
  return { drag, suppressClick, onPointerDown };
}
