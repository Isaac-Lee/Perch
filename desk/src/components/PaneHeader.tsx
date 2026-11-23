import { GitBranch, Network, Square, X } from "lucide-react";
import { ThinkingOrb } from "thinking-orbs";
import { useIsLight } from "../lib/theme";
import type { Pane, Session } from "../lib/types";
import { displayState } from "../lib/groups";
import { fmtElapsed } from "../lib/format";
import { activityOf } from "../lib/orbState";
import { paneIcon } from "../lib/paneIcon";
import { agentName } from "./SessionRow";

export default function PaneHeader({ pane, session, now, focused, onClose, onStop, dragging, onDragStart, graph }: { pane: Pane; session?: Session; now: number; focused: boolean; onClose: () => void; onStop: () => void; dragging?: boolean; onDragStart?: (e: React.PointerEvent<HTMLElement>) => void; /** subagent graph toggle; undefined hides the button */ graph?: { open: boolean; running: number; onToggle: () => void } }) {
  const light = useIsLight();
  const st = session ? displayState(session, now) : null;
  const waiting = st === "approval" || st === "question" || st === "reply";
  return (
    <div className={`pane-head${focused ? " focused" : ""}${dragging ? " dragging" : ""}`} onPointerDown={onDragStart}>
      {(st === "plain" || st === "ready") && <span className="dot" />}
      {st === "done" && <span className="dot ok" />}
      {waiting && <span className="dot warn" title={st === "approval" ? "Needs approval" : st === "reply" ? "Reply needed" : "Question"} />}
      {(() => { const { Icon, title } = paneIcon(pane.agent, pane.view); return <span className="pane-view" title={title}><Icon size={14} strokeWidth={1.5} /></span>; })()}
      <span className="pane-title">{agentName(pane.agent)} · {pane.title}</span>
      {pane.branch && <span className="branch"><GitBranch size={13} strokeWidth={1.5} /><span className="ellipsis">{pane.branch}</span></span>}
      <span className="grow" />
      {(st === "running" || st === "thinking" || st === "tool") && session && (() => { const a = activityOf(st, session.tool); return (
        <span className="think" title={session.toolDetail || undefined}>
          <ThinkingOrb state={a.orb} size={20} theme={light ? "light" : "dark"} />
          {a.label} {fmtElapsed(Math.max(0, now - session.since))}
        </span>
      ); })()}
      {graph && <button className={`stop-btn${graph.open ? " on" : ""}`} aria-label="Subagents" aria-pressed={graph.open} title="서브에이전트·백그라운드 작업 보기" onMouseDown={(e) => { if (e.button !== 0) return; e.preventDefault(); graph.onToggle(); }} onClick={(e) => { e.stopPropagation(); if (e.detail === 0) graph.onToggle(); }}><Network size={14} strokeWidth={1.5} />{graph.running > 0 && graph.running}</button>}
      {(st === "running" || st === "thinking" || st === "tool") && (
        <button className="stop-btn" aria-label="Stop" title="진행 중인 작업을 멈춥니다." onClick={(e) => { e.stopPropagation(); onStop(); }}><Square size={14} strokeWidth={1.5} />Stop</button>
      )}
      <button className="icon-btn" aria-label="Close" onClick={onClose}><X size={16} strokeWidth={1.5} /></button>
    </div>
  );
}
