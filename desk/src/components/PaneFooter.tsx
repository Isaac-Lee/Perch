import { ThinkingOrb } from "thinking-orbs";
import type { Session } from "../lib/types";
import { displayState } from "../lib/groups";
import { fmtElapsed } from "../lib/format";

export default function PaneFooter({ session, now }: { session?: Session; now: number }) {
  if (!session) return null;
  const st = displayState(session, now);
  if (st === "running" || st === "thinking" || st === "tool") {
    const what = session.tool ? `${session.tool}: ${session.toolDetail}` : "Working";
    return (
      <div className="pane-foot">
        <ThinkingOrb state="composing" size={20} theme="dark" />
        <span className="ellipsis">{what} · {session.steps === 1 ? "1 step" : `${session.steps} steps`} · {fmtElapsed(now - (session.turnStart ?? session.since))}</span>
      </div>
    );
  }
  if (st === "plain" || st === "ready") return <div className="pane-foot muted"><span>&nbsp;</span></div>;
  if (st === "done") return <div className="pane-foot muted"><span>Done · {fmtElapsed(now - session.since)}</span></div>;
  return null;
}
