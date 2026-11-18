import { ArchiveRestore, Circle, CircleCheck, CircleDot, Square, X } from "lucide-react";
import type { AgentKind, Session, Todo } from "../lib/types";
import { displayState, sessionTitle, shownSeconds } from "../lib/groups";
import { fmtElapsed, stateLabel } from "../lib/format";
import { fmtTok, totalTokens } from "../lib/usage";

export const agentName = (a: AgentKind) => (a === "hermes" ? "Hermes" : a === "opencode" ? "OpenCode" : "Shell");

const TONE = { running: "ok", thinking: "ok", tool: "ok", approval: "warn", question: "warn", done: "ok", ready: "muted", plain: "muted", closed: "muted", stale: "muted" } as const;
const TODO_ICON: Record<Todo["status"], typeof Circle> = { done: CircleCheck, in_progress: CircleDot, pending: Circle };

export default function SessionRow({ s, now, focused, onClick, onApprove, onStop, onArchive, onClose, archived }: {
  s: Session; now: number; focused: boolean; onClick: () => void; onApprove: (allow: boolean) => void; onStop: () => void;
  onArchive?: () => void; onClose?: () => void; archived?: boolean;
}) {
  const st = displayState(s, now);
  const tone = TONE[st];
  const shown = shownSeconds(s, now);
  const working = st === "running" || st === "thinking" || st === "tool";
  return (
    <div className={`row${focused ? " focused" : ""}`} role="button" tabIndex={0} onClick={onClick}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) onClick(); }}>
      <div className="row-top">
        <span className={`dot ${tone}${working ? " blink" : ""}`} />
        <span className="row-agent">{agentName(s.agent)}</span>
        {s.branch && <span className="row-branch ellipsis">{s.branch}</span>}
        {st !== "plain" && st !== "ready" && <span className={`row-state ${tone}`}>{stateLabel(st)}</span>}
        <span className="row-time">{shown !== null && fmtElapsed(shown)}</span>
        {working && <button className="row-stop" aria-label="Stop" title="진행 중인 작업을 멈춥니다." onClick={(e) => { e.stopPropagation(); onStop(); }}><Square size={14} strokeWidth={1.5} /></button>}
        {onClose && <button className="row-stop" aria-label="Close" title={s.agent === "hermes" ? "칸을 닫습니다. 작업은 계속됩니다." : "칸을 닫습니다."} onClick={(e) => { e.stopPropagation(); onClose(); }}><X size={14} strokeWidth={1.5} /></button>}
        {onArchive && (
          <button className="row-stop" aria-label={archived ? "Unarchive" : "Archive"} title={archived ? "보관을 풀고 목록에 다시 보입니다." : "보관하고 목록에서 숨깁니다."}
            onClick={(e) => { e.stopPropagation(); onArchive(); }}>
            {archived ? <ArchiveRestore size={14} strokeWidth={1.5} /> : <X size={14} strokeWidth={1.5} />}
          </button>
        )}
      </div>
      <div className="row-line"><span className="row-prompt ellipsis" title={s.prompt}>{sessionTitle(s)}</span>{s.subagents.length > 0 && <span className="row-sub">{s.subagents.length === 1 ? "1 agent" : `${s.subagents.length} agents`}</span>}{s.usage && <span className="row-tok" title="Tokens">{fmtTok(totalTokens(s.usage))}</span>}</div>
      {s.pending && <div className="row-pending ellipsis">{s.pending.text}</div>}
      {s.state === "approval" && (
        <div className="row-actions">
          <button className="btn primary" onClick={(e) => { e.stopPropagation(); onApprove(true); }}>Allow</button>
          <button className="btn" onClick={(e) => { e.stopPropagation(); onApprove(false); }}>Deny</button>
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
