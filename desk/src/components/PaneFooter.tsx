import { ThinkingOrb } from "thinking-orbs";
import { useIsLight } from "../lib/theme";
import type { Session } from "../lib/types";
import { displayState, shownSeconds } from "../lib/groups";
import { fmtElapsed } from "../lib/format";

export default function PaneFooter({ session, now }: { session?: Session; now: number }) {
  const light = useIsLight();
  if (!session) return null;
  const st = displayState(session, now);
  let t: number | null;
  if (st === "running" || st === "thinking" || st === "tool") {
    const what = session.tool ? `${session.tool}: ${session.toolDetail}` : "Working";
    return (
      <div className="pane-foot">
        <ThinkingOrb state="composing" size={20} theme={light ? "light" : "dark"} />
        <span className="ellipsis">{what} · {session.steps === 1 ? "1 step" : `${session.steps} steps`} · {fmtElapsed(shownSeconds(session, now) ?? 0)}</span>
      </div>
    );
  }
  if (st === "plain" || st === "ready") return <div className="pane-foot muted"><span>&nbsp;</span></div>;
  if (st === "done") return <div className="pane-foot muted"><span>{(t = shownSeconds(session, now)) === null ? "Done" : `Done · ${fmtElapsed(t)}`}</span></div>;
  return null;
}
