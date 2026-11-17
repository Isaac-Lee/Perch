import { GitBranch, Square, X } from "lucide-react";
import { ThinkingOrb } from "thinking-orbs";
import type { Pane, Session } from "../lib/types";
import { displayState } from "../lib/groups";
import { fmtElapsed } from "../lib/format";
import { agentName } from "./SessionRow";

export default function PaneHeader({ pane, session, now, focused, onClose, onStop }: { pane: Pane; session?: Session; now: number; focused: boolean; onClose: () => void; onStop: () => void }) {
  const st = session ? displayState(session, now) : null;
  const waiting = st === "approval" || st === "question";
  return (
    <div className={`pane-head${focused ? " focused" : ""}`}>
      {waiting && <span className="dot warn" title={st === "approval" ? "Needs approval" : "Question"} />}
      <span className="pane-title">{agentName(pane.agent)} · {pane.title}</span>
      {pane.branch && <span className="branch"><GitBranch size={13} strokeWidth={1.5} /><span className="ellipsis">{pane.branch}</span></span>}
      <span className="grow" />
      {st === "thinking" && session && (
        <span className="think">
          <ThinkingOrb state="working" size={20} theme="dark" />
          <span>Thinking {fmtElapsed(now - session.since)}</span>
        </span>
      )}
      {(st === "running" || st === "thinking" || st === "tool") && (
        <button className="stop-btn" aria-label="Stop" title="진행 중인 작업을 멈춥니다." onClick={(e) => { e.stopPropagation(); onStop(); }}><Square size={14} strokeWidth={1.5} />Stop</button>
      )}
      <button className="icon-btn" aria-label="Close" onClick={onClose}><X size={16} strokeWidth={1.5} /></button>
    </div>
  );
}
