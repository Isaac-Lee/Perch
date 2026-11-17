import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, PanelLeftClose } from "lucide-react";
import type { Pane, Session } from "../lib/types";
import { MY_TURN, displayState, groupSessions } from "../lib/groups";
import SessionRow from "./SessionRow";

export default function Sidebar({ sessions, panes, now, focusedPaneId, onFocus, onApprove, onCollapse }: {
  sessions: Session[]; panes: Pane[]; now: number; focusedPaneId: string | null;
  onFocus: (id: string) => void; onApprove: (id: string, allow: boolean) => void; onCollapse: () => void;
}) {
  const groups = useMemo(() => groupSessions(sessions, now), [sessions, now]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const focusedSession = panes.find((p) => p.id === focusedPaneId)?.sessionId;
  const live = groups.flatMap((g) => g.sessions);
  const working = live.filter((s) => ["running", "thinking", "tool"].includes(displayState(s, now))).length;
  const mine = live.filter((s) => MY_TURN.includes(s.state)).length;
  const toggle = (k: string) => setOpen((o) => { const n = new Set(o); if (!n.delete(k)) n.add(k); return n; });
  return (
    <aside className="sidebar">
      <div className="side-head">
        <div>
          <div className="side-title">세션</div>
          <div className="side-sum">작업중 {working} · 내 차례 {mine}</div>
        </div>
        <button className="icon-btn" aria-label="패널 접기" onClick={onCollapse}><PanelLeftClose size={16} strokeWidth={1.5} /></button>
      </div>
      <div className="side-body">
        {groups.map((g) => (
          <div key={g.key} className="group">
            <div className="group-title"><span className="ellipsis">{g.label}</span><span className="count">{g.sessions.length}</span></div>
            {g.sessions.map((s) => (
              <SessionRow key={s.sessionId} s={s} now={now} focused={s.sessionId === focusedSession}
                onClick={() => onFocus(s.sessionId)} onApprove={(a) => onApprove(s.sessionId, a)} />
            ))}
            {g.recent.length > 0 && (
              <>
                <button className="recent-toggle" onClick={() => toggle(g.key)}>
                  {open.has(g.key) ? <ChevronDown size={16} strokeWidth={1.5} /> : <ChevronRight size={16} strokeWidth={1.5} />}
                  최근 <span className="count">{g.recent.length}</span>
                </button>
                {open.has(g.key) && g.recent.map((s) => (
                  <SessionRow key={s.sessionId} s={s} now={now} focused={s.sessionId === focusedSession}
                    onClick={() => onFocus(s.sessionId)} onApprove={(a) => onApprove(s.sessionId, a)} />
                ))}
              </>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}
