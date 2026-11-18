import { useEffect, useRef, useState } from "react";
import type { DropTarget, Side } from "./grid";

const THRESHOLD = 5, EDGE = 0.3;
export interface PaneDrag { id: string; target: DropTarget | null; box: { left: number; top: number; width: number; height: number } | null }

/** Zone of a point inside a pane: the outer 30% on a side wins, the axis the point is further from the centre on decides. */
export function dropSide(nx: number, ny: number): Side | null {
  const dx = Math.abs(nx - 0.5) * 2, dy = Math.abs(ny - 0.5) * 2, min = 1 - EDGE * 2;
  if (Math.max(dx, dy) < min) return null;
  return dx >= dy ? (nx < 0.5 ? "left" : "right") : ny < 0.5 ? "top" : "bottom";
}

/** Drag a pane by its header and drop it on another pane. Panes carry `data-pane-id`; hit-testing uses their
 *  bounding rects because terminals swallow pointer events. HTML5 DnD does not fire in WebView2. */
export function usePaneDrag(move: (id: string, target: DropTarget) => void) {
  const [drag, setDrag] = useState<PaneDrag | null>(null);
  const moveRef = useRef(move);
  moveRef.current = move;
  const teardown = useRef<(() => void) | null>(null);
  useEffect(() => () => teardown.current?.(), []);

  const onPointerDown = (e: React.PointerEvent<HTMLElement>, id: string) => {
    if (e.button !== 0 || (e.target as Element).closest("button")) return;
    const head = e.currentTarget, pid = e.pointerId, x0 = e.clientX, y0 = e.clientY;
    let started = false, aborted = false, target: DropTarget | null = null;
    const hit = (x: number, y: number) => {
      target = null;
      let box: PaneDrag["box"] = null;
      for (const el of document.querySelectorAll<HTMLElement>("[data-pane-id]")) {
        const r = el.getBoundingClientRect(), tid = el.dataset.paneId!;
        if (tid === id || x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
        const side = dropSide((x - r.left) / r.width, (y - r.top) / r.height);
        if (!side) break;
        target = { id: tid, side };
        const w = side === "left" || side === "right", half = w ? r.width / 2 : r.height / 2;
        box = { left: side === "right" ? r.left + half : r.left, top: side === "bottom" ? r.top + half : r.top, width: w ? half : r.width, height: w ? r.height : half };
        break;
      }
      setDrag({ id, target, box });
    };
    const move = (m: PointerEvent) => {
      if (aborted) return;
      if (!started) {
        if (Math.hypot(m.clientX - x0, m.clientY - y0) <= THRESHOLD) return;
        started = true;
        try { head.setPointerCapture(pid); } catch { /* pointer already gone */ }
        document.body.classList.add("pane-dragging");
      }
      hit(m.clientX, m.clientY);
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("keydown", key, true);
      document.body.classList.remove("pane-dragging");
      try { head.releasePointerCapture(pid); } catch { /* not captured */ }
      setDrag(null);
      teardown.current = null;
    };
    const up = () => { stop(); if (started && !aborted && target) moveRef.current(id, target); };
    const key = (k: KeyboardEvent) => { if (k.key === "Escape" && started) { aborted = true; k.stopPropagation(); setDrag(null); } };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", stop);
    window.addEventListener("keydown", key, true);
    teardown.current = stop;
  };
  return { drag, onPointerDown };
}
