import type { Pane as PaneT, Session } from "../lib/types";
import { gridLayout } from "../lib/grid";
import Pane from "./Pane";

export default function PaneGrid({ panes, sessions, now, focusedPaneId, stopped, onFocus, onClose, onStop }: {
  panes: PaneT[]; sessions: Session[]; now: number; focusedPaneId: string | null; onFocus: (id: string) => void; onClose: (id: string) => void;
  stopped: Record<string, number>; onStop: (sessionId: string) => void;
}) {
  const { cols, rows, cells } = gridLayout(panes.length);
  if (!panes.length) return <div className="grid-empty"><div className="empty-title">No panes</div><div className="empty-body">오른쪽 위 + 버튼으로 새 칸을 엽니다.</div></div>;
  return (
    <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
      {panes.map((p, i) => (
        <Pane key={p.id} pane={p} now={now}
          session={sessions.find((s) => s.sessionId === p.sessionId)}
          focused={p.id === focusedPaneId} onFocus={() => onFocus(p.id)} onClose={() => onClose(p.id)}
          stopCount={stopped[p.sessionId ?? ""] ?? 0} onStop={() => p.sessionId && onStop(p.sessionId)}
          style={{ gridColumn: `${cells[i].col + 1} / span ${cells[i].colSpan}`, gridRow: cells[i].row + 1 }} />
      ))}
    </div>
  );
}
