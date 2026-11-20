import { useEffect, useMemo, useRef, useState } from "react";
import type { Pane as PaneT, Session } from "../lib/types";
import { displayState, sessionTitle } from "../lib/groups";
import { activityOf } from "../lib/orbState";
import { stateLabel } from "../lib/format";
import { closeGraph, paneGraphData, runningCount, toggleGraph, useGraphOpen, usePaneGraph } from "../lib/paneGraph";
import PaneHeader from "./PaneHeader";
import PaneFooter from "./PaneFooter";
import TerminalView from "./TerminalView";
import { loadGraphDock, saveGraphDock } from "../lib/uiSettings";
import SubagentGraph from "./SubagentGraph";

export default function Pane({ pane, session, now, focused, stopCount, onFocus, onClose, onStop, style, dragging, onDragStart, bgSessions, onFocusSession }: {
  pane: PaneT; session?: Session; now: number; focused: boolean; stopCount: number; onFocus: () => void; onClose: () => void; onStop: () => void; style: React.CSSProperties;
  dragging?: boolean; onDragStart?: (e: React.PointerEvent<HTMLElement>) => void; /** `bg_` sessions started from this pane */ bgSessions: Session[]; onFocusSession: (id: string) => void;
}) {
  const chat = usePaneGraph().get(pane.id);
  const data = useMemo(() => paneGraphData(chat, session, bgSessions), [chat, session, bgSessions]);
  const open = useGraphOpen().has(pane.id);
  const has = data.subagents.length + data.background.length > 0;
  const ref = useRef<HTMLElement>(null);
  const [w, setW] = useState(0);
  const [pref, setPref] = useState(loadGraphDock);
  const dock = pref === "bottom" || w < 560 || (pref === null && w < 760) ? "bottom" : "right";
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width)); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const st = session ? displayState(session, now) : null;
  const act = session && (st === "running" || st === "thinking" || st === "tool") ? activityOf(st, session.tool) : undefined;
  return (
    <section ref={ref} className={`pane${focused ? " focused" : ""}`} style={style} data-pane-id={pane.id} onMouseDown={onFocus}>
      <PaneHeader pane={pane} session={session} now={now} focused={focused} onClose={onClose} onStop={onStop} dragging={dragging} onDragStart={onDragStart}
        graph={has ? { open, running: runningCount(data), onToggle: () => toggleGraph(pane.id) } : undefined} />
      <div className={`pane-body${dock === "right" ? " wide" : ""}`}>
        <div className="pane-main"><TerminalView paneId={pane.id} focused={focused} agent={pane.agent} stopCount={stopCount} session={session} view={pane.view} cwd={pane.cwd} sessionId={pane.sessionId} /></div>
        {open && has && <SubagentGraph pane={pane} title={session ? sessionTitle(session) || pane.title : pane.title} rootAct={act} rootLabel={(act ? act.label + (session!.toolDetail && session!.toolDetail.length <= 24 ? ` ${session!.toolDetail}` : "") : st && stateLabel(st)) || "Ready"} data={data} dock={dock} onDock={(d) => { setPref(d); saveGraphDock(d); }} onClose={() => closeGraph(pane.id)} onFocusSession={onFocusSession} />}
      </div>
      <PaneFooter session={session} now={now} />
    </section>
  );
}
