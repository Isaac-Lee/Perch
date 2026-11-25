import { Archive, ArchiveRestore, ChevronRight, Circle, CircleCheck, CircleDot, GitFork, Square, X } from "lucide-react";
import type { AgentKind, Session, Todo } from "../lib/types";
import { displayState, isBackgroundId, sessionTitle, shownSeconds } from "../lib/groups";
import { fmtElapsed, stateLabel } from "../lib/format";
import { fmtTok, totalTokens } from "../lib/usage";

export const agentName = (a: AgentKind) => (a === "hermes" ? "Hermes" : a === "opencode" ? "OpenCode" : "Shell");

const TONE = { running: "ok", thinking: "ok", tool: "ok", approval: "warn", question: "warn", reply: "warn", done: "ok", ready: "muted", plain: "muted", closed: "muted", stale: "muted" } as const;
export const TODO_ICON: Record<Todo["status"], typeof Circle> = { done: CircleCheck, in_progress: CircleDot, pending: Circle };

export interface RowDrag { dragging: boolean; onPointerDown: (e: React.PointerEvent<HTMLElement>) => void; onMove: (dir: -1 | 1) => void }

export default function SessionRow({ s, now, focused, onClick, onApprove, onStop, onFork, onArchive, onHide, archived, drag, unread, folder, kids, onGraph }: {
  s: Session; now: number; focused: boolean; onClick: () => void; onApprove: (allow: boolean) => void; onStop: () => void; /** fork from the end of the conversation (Hermes chat panes only) */ onFork?: () => void;
  onArchive?: () => void; onHide?: () => void; archived?: boolean; drag?: RowDrag; unread?: boolean; folder?: string; /** background runs started from this session */ kids?: Session[]; /** open this pane's subagent graph (only when the session has a pane) */ onGraph?: () => void;
}) {
  const st = displayState(s, now);
  const tone = TONE[st];
  const shown = shownSeconds(s, now);
  const working = st === "running" || st === "thinking" || st === "tool";
  return (
    <div className={`row${focused ? " focused" : ""}${drag?.dragging ? " dragging" : ""}${unread ? " unread" : ""}`} role="group" aria-label={[agentName(s.agent), sessionTitle(s), stateLabel(st)].filter(Boolean).join(" · ")} onClick={onClick}
      data-sid={drag ? s.sessionId : undefined} onPointerDown={drag?.onPointerDown}>
      <div className="row-top">
        <span className={`dot ${tone}${working ? " blink" : ""}`} aria-hidden="true" />
        <span className="row-agent">{agentName(s.agent)}</span>
        {folder && <span className="row-folder ellipsis">{folder}</span>}
        {s.branch && <span className="row-branch ellipsis">{s.branch}</span>}
        {st !== "plain" && st !== "ready" && <span className={`row-state ${tone}`}>{stateLabel(st)}</span>}
        <span className="row-time">{shown !== null && fmtElapsed(shown)}</span>
        {working && <button className="row-stop" aria-label="Stop" title="진행 중인 작업을 멈춥니다." onClick={(e) => { e.stopPropagation(); onStop(); }}><Square size={14} strokeWidth={1.5} /></button>}
        {onFork && <button className="row-stop" aria-label="Fork" disabled={working} title={working ? "작업이 끝난 뒤에 포크할 수 있습니다" : "대화 끝에서 새 세션으로 포크합니다."} onClick={(e) => { e.stopPropagation(); onFork(); }}><GitFork size={14} strokeWidth={1.5} /></button>}
        {onHide && <button className="row-stop" aria-label="Hide" title={s.paneId ? (s.agent === "hermes" ? "칸을 닫고 목록에서 내립니다. 작업은 계속됩니다." : "칸을 닫고 목록에서 내립니다.") : "목록에서 내립니다. Recent에서 다시 볼 수 있습니다."} onClick={(e) => { e.stopPropagation(); onHide(); }}><X size={14} strokeWidth={1.5} /></button>}
        {onArchive && (
          <button className="row-stop" aria-label={archived ? "Unarchive" : "Archive"} title={archived ? "보관을 풀고 목록에 다시 보입니다." : s.paneId ? "칸을 닫고 보관합니다." : "보관합니다. Archived에서 되돌릴 수 있습니다."}
            onClick={(e) => { e.stopPropagation(); onArchive(); }}>
            {archived ? <ArchiveRestore size={14} strokeWidth={1.5} /> : <Archive size={14} strokeWidth={1.5} />}
          </button>
        )}
      </div>
      <div className="row-line">{unread && <span className="dot unread" role="img" aria-label="Unread" title="아직 보지 않은 결과가 있습니다." />}<button className="row-prompt ellipsis" onKeyDown={(e) => { if (drag && e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); drag.onMove(e.key === "ArrowUp" ? -1 : 1); } }} title={isBackgroundId(s.sessionId) ? `다른 세션에서 실행한 백그라운드 작업입니다.\n${s.prompt}` : s.prompt}>{isBackgroundId(s.sessionId) && <><ChevronRight className="row-bg-chev" size={12} strokeWidth={1.75} />Background · </>}{sessionTitle(s)}</button>{s.subagents.length > 0 && (() => { const t = s.subagents.length === 1 ? "1 agent" : `${s.subagents.length} agents`; return onGraph ? <button className="row-sub row-sub-btn" title="서브에이전트 그래프를 엽니다." onClick={(e) => { e.stopPropagation(); onGraph(); }}>{t}</button> : <span className="row-sub">{t}</span>; })()}{s.usage && <span className="row-tok" title="Tokens">{fmtTok(totalTokens(s.usage))}</span>}</div>
      {s.pending && <div className="row-pending ellipsis">{s.pending.text}</div>}
      {!s.pending && st === "reply" && s.ask && <div className="row-pending ellipsis" title={s.ask}>{s.ask}</div>}
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
      {kids?.map((c) => {
        const cs = displayState(c, now), t = shownSeconds(c, now), label = stateLabel(cs);
        const body = <><span className="tree">└</span><span className="ellipsis" title={c.prompt}>Background · {sessionTitle(c)}{label && ` · ${label}`}</span><span className="row-time">{t !== null && fmtElapsed(t)}</span></>;
        return onGraph
          ? <button key={c.sessionId} className="row-line row-line-link" onClick={(e) => { e.stopPropagation(); onGraph(); }}>{body}</button>
          : <div key={c.sessionId} className="row-line">{body}</div>;
      })}
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
