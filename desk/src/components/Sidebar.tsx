import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpDown, Check, ChevronDown, ChevronRight, PanelLeftClose, Plus, Search, X } from "lucide-react";
import type { Group, Pane, Session } from "../lib/types";
import { SESSION_SORTS, displayState, groupByStatus, nestBackground, groupSessions, groupSummary, isUnread, matchSession, moveInOrder, splitNeedsYou, waitingOnYou, type GroupBy, type SessionSort } from "../lib/groups";
import SessionRow from "./SessionRow";
import { openGraph } from "../lib/paneGraph";
import { clampSidebarWidth, SIDEBAR_DEFAULT, MAX_ORDER, loadArchived, loadCollapsed, loadDismissed, saveDismissed, loadReadAt, saveReadAt, markRead, loadSessionOrder, loadSessionSort, loadGroupBy, saveGroupBy, saveArchived, saveCollapsed, saveSessionOrder, saveSessionSort } from "../lib/uiSettings";
import { useScrollReveal } from "../lib/useScrollReveal";
import { useRowDrag } from "../lib/useRowDrag";
import { useDismiss } from "../lib/useDismiss";
import { useLiveSubagents } from "../lib/liveSubagents";
import { useBackgroundTasks } from "../lib/liveBackground";

const SORT_LABEL: Record<SessionSort, string> = { status: "Status", recent: "Recent activity", name: "Name", manual: "Manual order" };
import { fmtTok, summarize } from "../lib/usage";

import { formatShortcut } from "../lib/shortcuts";

const hiddenIn = (archived: Set<string>, s: Session) => !s.paneId && archived.has(s.sessionId);

export default function Sidebar({ sessions, panes, now, focusedPaneId, onFocus, onApprove, onStop, onClosePane, onCollapse, onUsage, onNew, newSession, width, onResize }: {
  sessions: Session[]; panes: Pane[]; now: number; focusedPaneId: string | null;
  onFocus: (id: string) => void; onApprove: (id: string, allow: boolean) => void; onStop: (id: string) => void; onClosePane: (paneId: string) => void; onCollapse: () => void; onUsage: () => void; onNew: (cwd: string) => void; newSession: React.ReactNode;
  width: number; onResize: (w: number) => void;
}) {
  // An archived session stays hidden until it gets an open pane again (resumed).
  const [archived, setArchived] = useState<Set<string>>(() => new Set(loadArchived()));
  const toggleArchive = (id: string) => setArchived((o) => { const n = new Set(o); if (!n.delete(id)) n.add(id); saveArchived([...n]); return n; });
  // X on a row: the row leaves the live list for Recent (nothing is archived). Cleared again once the session has a pane.
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set(loadDismissed()));
  const dismiss = (id: string) => setDismissed((o) => { if (o.has(id)) return o; const n = new Set([...o, id]); saveDismissed([...n]); return n; });
  useEffect(() => {
    const back = sessions.filter((s) => s.paneId && dismissed.has(s.sessionId));
    if (!back.length) return;
    setDismissed((o) => { const n = new Set(o); back.forEach((s) => n.delete(s.sessionId)); saveDismissed([...n]); return n; });
  }, [sessions, dismissed]);
  // Chat panes report their children over gateway frames, not the state file: fill empty rows from that live store.
  const liveSubs = useLiveSubagents();
  const shown = useMemo(() => sessions.filter((s) => !hiddenIn(archived, s)).map((s) => (!s.subagents.length && s.paneId && liveSubs.has(s.paneId) ? { ...s, subagents: liveSubs.get(s.paneId)! } : s)), [sessions, archived, liveSubs]);
  // Background runs nest under their parent row (see nestBackground); the rest of the sidebar only sees `top`.
  const bgTasks = useBackgroundTasks();
  const nest = useMemo(() => nestBackground(shown, bgTasks, now), [shown, bgTasks, now]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [sort, setSort] = useState<SessionSort>(loadSessionSort);
  const [order, setOrder] = useState<string[]>(loadSessionOrder);
  const [readAt, setReadAt] = useState<Record<string, number>>(loadReadAt);
  const markSeen = (id: string) => setReadAt((m) => { const n = markRead(m, id, now); saveReadAt(n); return n; });
  const allGroups = useMemo(() => groupSessions(nest.top, now, sort, order, dismissed, readAt), [nest, now, sort, order, dismissed, readAt]);
  const allSplit = useMemo(() => splitNeedsYou(allGroups, now), [allGroups, now]);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const split = useMemo(() => (q ? splitNeedsYou(groupSessions(nest.top.filter((s) => matchSession(s, q)), now, sort, order, dismissed, readAt), now) : allSplit), [q, nest, now, allSplit, sort, order, dismissed, readAt]);
  const groups = split.groups;
  const [groupBy, setGroupBy] = useState<GroupBy>(loadGroupBy);
  const chooseGroupBy = (g: GroupBy) => { setGroupBy(g); saveGroupBy(g); };
  const byStatus = groupBy === "status";
  const statusView = useMemo(() => groupByStatus(groups, now, readAt), [groups, now, readAt]);
  const chooseSort = (s: SessionSort) => { setSort(s); saveSessionSort(s); };
  // Reordering switches to manual; the saved order is the whole visible order so nothing jumps.
  const reorder = (gkey: string, id: string, to: number) => {
    const g = allSplit.groups.find((x) => x.key === gkey);
    if (!g) return;
    const moved = moveInOrder(g.sessions.map((s) => s.sessionId), id, to);
    const vis = allSplit.groups.flatMap((x) => (x.key === gkey ? moved : x.sessions.map((s) => s.sessionId)));
    const seen = new Set(vis);
    const next = [...vis, ...order.filter((i) => !seen.has(i))].slice(0, MAX_ORDER);
    setOrder(next); saveSessionOrder(next); chooseSort("manual");
  };
  const refocus = useRef<string | null>(null);
  const { drag: rowDrag, suppressClick, onPointerDown } = useRowDrag(!q && !byStatus, bodyRef, reorder);
  useEffect(() => { // React moves the row's DOM node on reorder, which drops focus
    if (refocus.current) bodyRef.current?.querySelector<HTMLElement>(`[data-sid="${CSS.escape(refocus.current)}"] .row-prompt`)?.focus();
    refocus.current = null;
  });
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);
  useDismiss(sortRef, sortOpen, useCallback(() => setSortOpen(false), []));
  const archivedList = useMemo(() => sessions.filter((s) => hiddenIn(archived, s) && (!q || matchSession(s, q))).sort((a, b) => b.seen - a.seen), [sessions, archived, q]);
  const [showArchived, setShowArchived] = useState(false);
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
  useEffect(() => { // a result is read once its pane has focus
    const s = focusedSession ? sessions.find((x) => x.sessionId === focusedSession) : undefined;
    if (s && isUnread(s, readAt, now)) markSeen(s.sessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedSession, now, sessions]);
  const live = allGroups.flatMap((g) => g.sessions);
  const working = live.filter((s) => ["running", "thinking", "tool"].includes(displayState(s, now))).length;
  const mine = live.filter((s) => waitingOnYou(s, now)).length;
  const todayTok = useMemo(() => summarize(sessions, "today", now).total.total, [sessions, now]);
  const isFolded = (k: string) => !q && folded.has(k);
  const isOpen = (k: string) => !!q || open.has(k);
  const row = (s: Session, g?: Group, folder?: string) => (
    <SessionRow key={s.sessionId} s={s} kids={nest.children.get(s.sessionId)} now={now} unread={isUnread(s, readAt, now)} folder={folder} focused={s.sessionId === focusedSession}
      drag={g && !q ? {
        dragging: rowDrag?.id === s.sessionId,
        onPointerDown: (e) => onPointerDown(e, s.sessionId),
        onMove: (dir) => {
          const i = g.sessions.indexOf(s), to = i + dir;
          if (to < 0 || to >= g.sessions.length) return;
          refocus.current = s.sessionId;
          reorder(g.key, s.sessionId, to);
        },
      } : undefined}
      onGraph={s.paneId ? () => { openGraph(s.paneId!); onFocus(s.sessionId); } : undefined}
      onClick={() => { if (!suppressClick.current) { onFocus(s.sessionId); markSeen(s.sessionId); } }} onApprove={(a) => onApprove(s.sessionId, a)} onStop={() => onStop(s.sessionId)}
      onHide={g || folder ? () => { if (s.paneId) onClosePane(s.paneId); dismiss(s.sessionId); } : undefined}
      onArchive={() => { if (s.paneId) onClosePane(s.paneId); toggleArchive(s.sessionId); }} archived={hiddenIn(archived, s)} />
  );
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
        <div className="side-search">
          <label className="side-action">
            <Search size={16} strokeWidth={1.5} />
            <input id="session-search" placeholder="Search" aria-label="Search sessions" value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") { setQuery(""); e.currentTarget.blur(); } }} />
            {query ? <button className="icon-btn" aria-label="Clear search" onClick={() => setQuery("")}><X size={14} strokeWidth={1.5} /></button> : <kbd>{formatShortcut("search")}</kbd>}
          </label>
          <div className="menu-wrap" ref={sortRef}>
            <button className="icon-btn" aria-label="Sort sessions" aria-expanded={sortOpen} title={`Sort · ${SORT_LABEL[sort]}`} onClick={() => setSortOpen((v) => !v)}><ArrowUpDown size={16} strokeWidth={1.5} /></button>
            {sortOpen && (
              <div className="menu" role="menu">
                <div className="menu-label">Sort</div>
                {SESSION_SORTS.map((s) => (
                  <button key={s} className="menu-item" role="menuitemradio" aria-checked={s === sort} disabled={byStatus} title={byStatus ? "상태별 보기에서는 정렬이 고정됩니다." : undefined} onClick={() => { chooseSort(s); setSortOpen(false); }}>
                    {SORT_LABEL[s]}{s === sort && <Check className="check" size={16} strokeWidth={1.5} />}
                  </button>
                ))}
                <div className="menu-sep" />
                <div className="menu-label">Group by</div>
                {(["folder", "status"] as const).map((g) => (
                  <button key={g} className="menu-item" role="menuitemradio" aria-checked={g === groupBy} onClick={() => { chooseGroupBy(g); setSortOpen(false); }}>
                    {g === "folder" ? "Folder" : "Status"}{g === groupBy && <Check className="check" size={16} strokeWidth={1.5} />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="side-body" ref={bodyRef}>
        <div>
        {q && groups.length === 0 && split.needs.length === 0 && archivedList.length === 0 && <div className="side-empty">일치하는 세션이 없습니다.</div>}
        {split.needs.length > 0 && (
          <div className="group needs-you">
            <div className="group-title"><span className="ellipsis">Needs you</span><span className="count">{split.needs.length}</span></div>
            {split.needs.map(({ s, label }) => row(s, undefined, label))}
          </div>
        )}
        {byStatus && statusView.sections.map((x) => {
          const k = `status:${x.key}`;
          return (
            <div key={k} className="group">
              <button className="group-title" aria-expanded={!isFolded(k)} onClick={() => fold(k)}>
                {isFolded(k) ? <ChevronRight size={16} strokeWidth={1.5} /> : <ChevronDown size={16} strokeWidth={1.5} />}
                <span className="ellipsis">{x.label}</span><span className="count">{x.items.length}</span>
              </button>
              {!isFolded(k) && x.items.map(({ s, label }) => row(s, undefined, label))}
            </div>
          );
        })}
        {byStatus && statusView.recent.length > 0 && (
          <div className="group">
            <button className="recent-toggle" onClick={() => toggle("status:recent")}>
              {isOpen("status:recent") ? <ChevronDown size={16} strokeWidth={1.5} /> : <ChevronRight size={16} strokeWidth={1.5} />}
              Recent <span className="count">{statusView.recent.length}</span>
            </button>
            {isOpen("status:recent") && statusView.recent.map(({ s }) => row(s))}
          </div>
        )}
        {!byStatus && groups.map((g) => (
          <div key={g.key} className="group" data-gkey={g.key}>
            <div className="group-head">
            <button className="group-title" aria-expanded={!isFolded(g.key)} onClick={() => fold(g.key)}>
              {isFolded(g.key) ? <ChevronRight size={16} strokeWidth={1.5} /> : <ChevronDown size={16} strokeWidth={1.5} />}
              <span className="ellipsis">{g.label}</span><span className="count">{g.sessions.length}</span>
              {isFolded(g.key) && (() => {
                const { mine, working, unread } = groupSummary(g, now, readAt);
                return (
                  <span className="group-sum">
                    {mine > 0 && <span className="sum-item warn"><span className="dot warn" />{mine}</span>}
                    {working > 0 && <span className="sum-item ok"><span className="dot ok" />{working}</span>}
                    {unread > 0 && <span className="sum-item unread" title="읽지 않은 세션"><span className="dot unread" />{unread}</span>}
                  </span>
                );
              })()}
            </button>
            {!g.isCommon && <button className="icon-btn group-add" aria-label={`New session in ${g.label}`} title={`New session · ${g.path}`} onClick={() => onNew(g.path)}><Plus size={14} strokeWidth={1.5} /></button>}
            </div>
            {!isFolded(g.key) && g.sessions.map((s) => row(s, g))}
            {rowDrag?.gkey === g.key && <div className="drop-line" style={{ top: rowDrag.y }} />}
            {!isFolded(g.key) && g.recent.length > 0 && (
              <>
                <button className="recent-toggle" onClick={() => toggle(g.key)}>
                  {isOpen(g.key) ? <ChevronDown size={16} strokeWidth={1.5} /> : <ChevronRight size={16} strokeWidth={1.5} />}
                  Recent <span className="count">{g.recent.length}</span>
                </button>
                {isOpen(g.key) && g.recent.map((s) => (
                  row(s)
                ))}
              </>
            )}
          </div>
        ))}
        {archivedList.length > 0 && (
          <div className="group">
            <button className="recent-toggle" aria-expanded={!!q || showArchived} onClick={() => setShowArchived((v) => !v)}>
              {q || showArchived ? <ChevronDown size={16} strokeWidth={1.5} /> : <ChevronRight size={16} strokeWidth={1.5} />}
              Archived <span className="count">{archivedList.length}</span>
            </button>
            {(q || showArchived) && archivedList.map((s) => row(s))}
          </div>
        )}
        </div>
      </div>
      <div className="resize-handle" role="separator" aria-orientation="vertical" aria-label="Resize sidebar" onPointerDown={drag} onDoubleClick={() => onResize(SIDEBAR_DEFAULT)} />
      {more && <div className="side-more"><ChevronDown size={16} strokeWidth={1.5} />More below</div>}
    </aside>
  );
}
