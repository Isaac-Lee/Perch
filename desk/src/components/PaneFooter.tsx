import { ThinkingOrb } from "thinking-orbs";
import { useIsLight } from "../lib/theme";
import type { Session } from "../lib/types";
import { displayState, shownSeconds } from "../lib/groups";
import { activityOf } from "../lib/orbState";
import { fmtElapsed } from "../lib/format";

export default function PaneFooter({ session, now }: { session?: Session; now: number }) {
  const light = useIsLight();
  if (!session) return null;
  const st = displayState(session, now);
  let t: number | null;
  if (st === "running" || st === "thinking" || st === "tool") {
    const what = session.tool ? `${session.tool}: ${session.toolDetail}` : "Working";
    const step = Math.max(0, now - session.since);
    const turn = shownSeconds(session, now) ?? 0;
    const total = (session.busyTotal ?? 0) + turn;
    return (
      <div className="pane-foot">
        <ThinkingOrb state={activityOf(st, session.tool).orb} size={20} theme={light ? "light" : "dark"} />
        <span className="ellipsis" title="Now: 현재 단계 · Turn: 이번 턴 · Session: 세션 누적">{what} · Now {fmtElapsed(step)} · Turn {fmtElapsed(turn)} · Session {fmtElapsed(total)} · {session.steps === 1 ? "1 step" : `${session.steps} steps`}</span>
      </div>
    );
  }
  if (st === "plain" || st === "ready") return <div className="pane-foot muted"><span>&nbsp;</span></div>;
  if (st === "done") return <div className="pane-foot muted"><span>{(t = shownSeconds(session, now)) === null ? "Done" : `Done · Turn ${fmtElapsed(t)} · Session ${fmtElapsed(Math.max(session.busyTotal ?? 0, t))}`}</span></div>;
  return null;
}
