import type { Pane as PaneT, Session } from "../lib/types";
import { placements, type DropTarget, type Layout } from "../lib/grid";
import { usePaneDrag } from "../lib/usePaneDrag";
import { useBackgroundTasks } from "../lib/liveBackground";
import { isBackgroundId } from "../lib/groups";
import Pane from "./Pane";

// Every Pane stays a flat sibling in the same order (the `panes` order) so layout changes never remount a terminal;
// position is only a gridColumn / gridRow style.
export default function PaneGrid({ panes, layout, onMove, sessions, now, focusedPaneId, stopped, onFocus, onClose, onStop, onFocusSession }: {
  panes: PaneT[]; layout: Layout; onMove: (id: string, target: DropTarget) => void; sessions: Session[]; now: number; focusedPaneId: string | null; onFocus: (id: string) => void; onClose: (id: string) => void;
  stopped: Record<string, number>; onStop: (sessionId: string) => void; onFocusSession: (sessionId: string) => void;
}) {
  const tasks = useBackgroundTasks();
  const { cols, rows, cells } = placements(layout);
  const { drag, onPointerDown } = usePaneDrag(onMove);
  if (!panes.length) return <div className="grid-empty"><div className="empty-title">No open sessions</div><div className="empty-body">오른쪽 위 + 버튼으로 새 세션을 엽니다.</div></div>;
  return (
    <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
      {panes.map((p) => {
        const c = cells[p.id] ?? { col: 0, row: 0, rowSpan: 1 };
        return (
          <Pane key={p.id} pane={p} now={now}
            session={sessions.find((s) => s.sessionId === p.sessionId)} onFocusSession={onFocusSession}
            bgSessions={sessions.filter((s) => isBackgroundId(s.sessionId) && (tasks.get(s.sessionId) === p.id || (!!p.sessionId && s.parentId === p.sessionId)))}
            focused={p.id === focusedPaneId} onFocus={() => onFocus(p.id)} onClose={() => onClose(p.id)}
            stopCount={stopped[p.sessionId ?? ""] ?? 0} onStop={() => p.sessionId && onStop(p.sessionId)}
            dragging={drag?.id === p.id} onDragStart={(e) => onPointerDown(e, p.id)}
            style={{ gridColumn: c.col + 1, gridRow: `${c.row + 1} / span ${c.rowSpan}` }} />
        );
      })}
      {drag?.box && <div className="drop-zone" style={drag.box} />}
    </div>
  );
}
