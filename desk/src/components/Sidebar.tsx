import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, PanelLeftClose } from "lucide-react";
import type { Pane, Session } from "../lib/types";
import { MY_TURN, displayState, groupSessions, groupSummary } from "../lib/groups";
import SessionRow from "./SessionRow";
import { clampSidebarWidth, SIDEBAR_DEFAULT, loadCollapsed, saveCollapsed } from "../lib/uiSettings";
import { useScrollReveal } from "../lib/useScrollReveal";

export default function Sidebar({ sessions, panes, now, focusedPaneId, onFocus, onApprove, onStop, onCollapse, width, onResize }: {
  sessions: Session[]; panes: Pane[]; now: number; focusedPaneId: string | null;
  onFocus: (id: string) => void; onApprove: (id: string, allow: boolean) => void; onStop: (id: string) => void; onCollapse: () => void;
  width: number; onResize: (w: number) => void;
}) {
  const groups = useMemo(() => groupSessions(sessions, now), [sessions, now]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [folded, setFolded] = useState<Set<string>>(() => new Set(loadCollapsed()));
  const fold = (k: string) => setFolded((o) => { const n = new Set(o); if (!n.delete(k)) n.add(k); saveCollapsed([...n]); return n; });
  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const x0 = e.clientX, w0 = width;
    const move = (m: PointerEvent) => onResize(clampSidebarWidth(w0 + m.clientX - x0));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const bodyRef = useRef<HTMLDivElement>(null);
  useScrollReveal(bodyRef);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = bodyRef.current!;
    const calc = () => setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
    calc();
    el.addEventListener("scroll", calc, { passive: true });
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => { el.removeEventListener("scroll", calc); ro.disconnect(); };
  }, []);
  const focusedSession = panes.find((p) => p.id === focusedPaneId)?.sessionId;
  const live = groups.flatMap((g) => g.sessions);
  const working = live.filter((s) => ["running", "thinking", "tool"].includes(displayState(s, now))).length;
  const mine = live.filter((s) => MY_TURN.includes(s.state)).length;
  const toggle = (k: string) => setOpen((o) => { const n = new Set(o); if (!n.delete(k)) n.add(k); return n; });
  return (
    <aside className="sidebar" style={{ width }}>
      <div className="side-head">
        <div>
          <div className="side-title">세션</div>
          <div className="side-sum">작업중 {working} · 내 차례 {mine}</div>
        </div>
        <button className="icon-btn" aria-label="패널 접기" onClick={onCollapse}><PanelLeftClose size={16} strokeWidth={1.5} /></button>
      </div>
      <div className="side-body" ref={bodyRef}>
        <div>
        {groups.map((g) => (
          <div key={g.key} className="group">
            <button className="group-title" aria-expanded={!folded.has(g.key)} onClick={() => fold(g.key)}>
              {folded.has(g.key) ? <ChevronRight size={16} strokeWidth={1.5} /> : <ChevronDown size={16} strokeWidth={1.5} />}
              <span className="ellipsis">{g.label}</span><span className="count">{g.sessions.length}</span>
              {folded.has(g.key) && (() => {
                const { mine, working } = groupSummary(g, now);
                return (
                  <span className="group-sum">
                    {mine > 0 && <span className="sum-item warn"><span className="dot warn" />{mine}</span>}
                    {working > 0 && <span className="sum-item ok"><span className="dot ok" />{working}</span>}
                  </span>
                );
              })()}
            </button>
            {!folded.has(g.key) && g.sessions.map((s) => (
              <SessionRow key={s.sessionId} s={s} now={now} focused={s.sessionId === focusedSession}
                onClick={() => onFocus(s.sessionId)} onApprove={(a) => onApprove(s.sessionId, a)} onStop={() => onStop(s.sessionId)} />
            ))}
            {!folded.has(g.key) && g.recent.length > 0 && (
              <>
                <button className="recent-toggle" onClick={() => toggle(g.key)}>
                  {open.has(g.key) ? <ChevronDown size={16} strokeWidth={1.5} /> : <ChevronRight size={16} strokeWidth={1.5} />}
                  최근 <span className="count">{g.recent.length}</span>
                </button>
                {open.has(g.key) && g.recent.map((s) => (
                  <SessionRow key={s.sessionId} s={s} now={now} focused={s.sessionId === focusedSession}
                    onClick={() => onFocus(s.sessionId)} onApprove={(a) => onApprove(s.sessionId, a)} onStop={() => onStop(s.sessionId)} />
                ))}
              </>
            )}
          </div>
        ))}
        </div>
      </div>
      <div className="resize-handle" role="separator" aria-orientation="vertical" aria-label="패널 폭 조절" onPointerDown={drag} onDoubleClick={() => onResize(SIDEBAR_DEFAULT)} />
      {more && <div className="side-more"><ChevronDown size={16} strokeWidth={1.5} />아래에 더 있음</div>}
    </aside>
  );
}
