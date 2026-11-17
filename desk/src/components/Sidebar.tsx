import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, PanelLeftClose, Plus, Search, X } from "lucide-react";
import type { Pane, Session } from "../lib/types";
import { MY_TURN, displayState, groupSessions, groupSummary, matchSession } from "../lib/groups";
import SessionRow from "./SessionRow";
import { clampSidebarWidth, SIDEBAR_DEFAULT, loadCollapsed, saveCollapsed } from "../lib/uiSettings";
import { useScrollReveal } from "../lib/useScrollReveal";
import { fmtTok, summarize } from "../lib/usage";

import { formatShortcut } from "../lib/shortcuts";

export default function Sidebar({ sessions, panes, now, focusedPaneId, onFocus, onApprove, onStop, onCollapse, onUsage, onNew, newSession, width, onResize }: {
  sessions: Session[]; panes: Pane[]; now: number; focusedPaneId: string | null;
  onFocus: (id: string) => void; onApprove: (id: string, allow: boolean) => void; onStop: (id: string) => void; onCollapse: () => void; onUsage: () => void; onNew: (cwd: string) => void; newSession: React.ReactNode;
  width: number; onResize: (w: number) => void;
}) {
  const allGroups = useMemo(() => groupSessions(sessions, now), [sessions, now]);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const groups = useMemo(() => (q ? groupSessions(sessions.filter((s) => matchSession(s, q)), now) : allGroups), [q, sessions, now, allGroups]);
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
  const live = allGroups.flatMap((g) => g.sessions);
  const working = live.filter((s) => ["running", "thinking", "tool"].includes(displayState(s, now))).length;
  const mine = live.filter((s) => MY_TURN.includes(s.state)).length;
  const todayTok = useMemo(() => summarize(sessions, "today", now).total.total, [sessions, now]);
  const isFolded = (k: string) => !q && folded.has(k);
  const isOpen = (k: string) => !!q || open.has(k);
  const toggle = (k: string) => setOpen((o) => { const n = new Set(o); if (!n.delete(k)) n.add(k); return n; });
  return (
    <aside className="sidebar" style={{ width }}>
      <div className="side-head">
        <div>
          <div className="side-title">Sessions</div>
          <div className="side-sum">{working} working · {mine} waiting on you</div>
          <button className="side-tok" title="Token usage" onClick={onUsage}>Today {fmtTok(todayTok)}</button>
        </div>
        <button className="icon-btn" aria-label="Collapse sidebar" onClick={onCollapse}><PanelLeftClose size={16} strokeWidth={1.5} /></button>
      </div>
      <div className="side-actions">
        {newSession}
        <label className="side-action">
          <Search size={16} strokeWidth={1.5} />
          <input id="session-search" placeholder="Search" aria-label="Search sessions" value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { setQuery(""); e.currentTarget.blur(); } }} />
          {query ? <button className="icon-btn" aria-label="Clear search" onClick={() => setQuery("")}><X size={14} strokeWidth={1.5} /></button> : <kbd>{formatShortcut("search")}</kbd>}
        </label>
      </div>
      <div className="side-body" ref={bodyRef}>
        <div>
        {q && groups.length === 0 && <div className="side-empty">일치하는 세션이 없습니다.</div>}
        {groups.map((g) => (
          <div key={g.key} className="group">
            <div className="group-head">
            <button className="group-title" aria-expanded={!isFolded(g.key)} onClick={() => fold(g.key)}>
              {isFolded(g.key) ? <ChevronRight size={16} strokeWidth={1.5} /> : <ChevronDown size={16} strokeWidth={1.5} />}
              <span className="ellipsis">{g.label}</span><span className="count">{g.sessions.length}</span>
              {isFolded(g.key) && (() => {
                const { mine, working } = groupSummary(g, now);
                return (
                  <span className="group-sum">
                    {mine > 0 && <span className="sum-item warn"><span className="dot warn" />{mine}</span>}
                    {working > 0 && <span className="sum-item ok"><span className="dot ok" />{working}</span>}
                  </span>
                );
              })()}
            </button>
            {!g.isCommon && <button className="icon-btn group-add" aria-label={`New session in ${g.label}`} title={`New session · ${g.key}`} onClick={() => onNew(g.key)}><Plus size={14} strokeWidth={1.5} /></button>}
            </div>
            {!isFolded(g.key) && g.sessions.map((s) => (
              <SessionRow key={s.sessionId} s={s} now={now} focused={s.sessionId === focusedSession}
                onClick={() => onFocus(s.sessionId)} onApprove={(a) => onApprove(s.sessionId, a)} onStop={() => onStop(s.sessionId)} />
            ))}
            {!isFolded(g.key) && g.recent.length > 0 && (
              <>
                <button className="recent-toggle" onClick={() => toggle(g.key)}>
                  {isOpen(g.key) ? <ChevronDown size={16} strokeWidth={1.5} /> : <ChevronRight size={16} strokeWidth={1.5} />}
                  Recent <span className="count">{g.recent.length}</span>
                </button>
                {isOpen(g.key) && g.recent.map((s) => (
                  <SessionRow key={s.sessionId} s={s} now={now} focused={s.sessionId === focusedSession}
                    onClick={() => onFocus(s.sessionId)} onApprove={(a) => onApprove(s.sessionId, a)} onStop={() => onStop(s.sessionId)} />
                ))}
              </>
            )}
          </div>
        ))}
        </div>
      </div>
      <div className="resize-handle" role="separator" aria-orientation="vertical" aria-label="Resize sidebar" onPointerDown={drag} onDoubleClick={() => onResize(SIDEBAR_DEFAULT)} />
      {more && <div className="side-more"><ChevronDown size={16} strokeWidth={1.5} />More below</div>}
    </aside>
  );
}
