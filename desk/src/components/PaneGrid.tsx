import { useCallback, useMemo, useRef } from "react";
import type { Pane as PaneT, Session } from "../lib/types";
import { placements, type DropTarget, type Layout } from "../lib/grid";
import { usePaneDrag } from "../lib/usePaneDrag";
import { useBackgroundTasks } from "../lib/liveBackground";
import { isBackgroundId } from "../lib/groups";
import Pane from "./Pane";

// Every Pane stays a flat sibling in the same order (the `panes` order) so layout changes never remount a terminal;
// position is only a gridColumn / gridRow style.
export default function PaneGrid({ panes, layout, onMove, sessions, focusedPaneId, stopped, onFocus, onClose, onStop, onFocusSession }: {
  panes: PaneT[]; layout: Layout; onMove: (id: string, target: DropTarget) => void; sessions: Session[]; focusedPaneId: string | null; onFocus: (id: string) => void; onClose: (id: string) => void;
  stopped: Record<string, number>; onStop: (sessionId: string) => void; onFocusSession: (sessionId: string) => void;
}) {
  const tasks = useBackgroundTasks();
  const { cols, rows, cells } = placements(layout);
  const { drag, onPointerDown } = usePaneDrag(onMove);
  const down = useRef(onPointerDown); down.current = onPointerDown;
  const dragStart = useCallback((e: React.PointerEvent<HTMLElement>, id: string) => down.current(e, id), []);
  const byId = useMemo(() => new Map(sessions.map((s) => [s.sessionId, s])), [sessions]);
  const bgByPane = useMemo(() => {
    const bg = sessions.filter((s) => isBackgroundId(s.sessionId));
    return new Map(panes.map((p) => [p.id, bg.filter((s) => tasks.get(s.sessionId) === p.id || (!!p.sessionId && s.parentId === p.sessionId))]));
  }, [sessions, panes, tasks]);
  if (!panes.length) return <div className="grid-empty"><div className="empty-title">No open sessions</div><div className="empty-body">오른쪽 위 + 버튼으로 새 세션을 엽니다.</div></div>;
  return (
    <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
      {panes.map((p) => {
        const c = cells[p.id] ?? { col: 0, row: 0, rowSpan: 1 };
        return (
          <Pane key={p.id} pane={p}
            session={p.sessionId ? byId.get(p.sessionId) : undefined} onFocusSession={onFocusSession}
            bgSessions={bgByPane.get(p.id)!}
            focused={p.id === focusedPaneId} onFocus={onFocus} onClose={onClose}
            stopCount={stopped[p.sessionId ?? ""] ?? 0} onStop={onStop}
            dragging={drag?.id === p.id} onDragStart={dragStart}
            col={c.col} row={c.row} rowSpan={c.rowSpan} />
        );
      })}
      {drag?.box && <div className="drop-zone" style={drag.box} />}
    </div>
  );
}
