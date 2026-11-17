import { Circle, CircleCheck, CircleDot } from "lucide-react";
import type { AgentKind, Session, Todo } from "../lib/types";
import { displayState } from "../lib/groups";
import { fmtElapsed, stateLabel } from "../lib/format";

export const agentName = (a: AgentKind) => (a === "hermes" ? "Hermes" : a === "opencode" ? "OpenCode" : "셸");

const TONE = { running: "ok", thinking: "ok", tool: "ok", approval: "warn", question: "warn", idle: "idle", closed: "muted", stale: "muted" } as const;
const TODO_ICON: Record<Todo["status"], typeof Circle> = { done: CircleCheck, in_progress: CircleDot, pending: Circle };

export default function SessionRow({ s, now, focused, onClick, onApprove }: {
  s: Session; now: number; focused: boolean; onClick: () => void; onApprove: (allow: boolean) => void;
}) {
  const st = displayState(s, now);
  const tone = TONE[st];
  return (
    <div className={`row${focused ? " focused" : ""}`} role="button" tabIndex={0} onClick={onClick}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) onClick(); }}>
      <div className="row-top">
        <span className={`dot ${tone}${tone === "ok" ? " blink" : ""}`} />
        <span className="row-agent">{agentName(s.agent)}</span>
        {s.branch && <span className="row-branch ellipsis">{s.branch}</span>}
        <span className={`row-state ${tone}`}>{stateLabel(st)}</span>
        <span className="row-time">{fmtElapsed(now - s.since)}</span>
      </div>
      <div className="row-line"><span className="row-prompt ellipsis">{s.prompt}</span>{s.subagents.length > 0 && <span className="row-sub">에이전트 {s.subagents.length}</span>}</div>
      {s.pending && <div className="row-pending ellipsis">{s.pending.text}</div>}
      {s.state === "approval" && (
        <div className="row-actions">
          <button className="btn primary" onClick={(e) => { e.stopPropagation(); onApprove(true); }}>허용</button>
          <button className="btn" onClick={(e) => { e.stopPropagation(); onApprove(false); }}>거절</button>
        </div>
      )}
      {s.subagents.map((a) => (
        <div key={a.id} className="row-line">
          <span className="tree">└</span><span className="ellipsis">{a.role} {a.goal}</span><span className="row-time">{fmtElapsed(now - a.start)}</span>
        </div>
      ))}
      {s.todos.map((t, i) => {
        const Icon = TODO_ICON[t.status];
        return (
          <div key={i} className={`row-line todo ${t.status}`}>
            <Icon size={16} strokeWidth={1.5} /><span className="ellipsis">{t.text}</span>
          </div>
        );
      })}
    </div>
  );
}
