import type { Pane as PaneT, Session } from "../lib/types";
import PaneHeader from "./PaneHeader";
import PaneFooter from "./PaneFooter";
import TerminalView from "./TerminalView";

export default function Pane({ pane, session, now, focused, stopCount, onFocus, onClose, onStop, style }: {
  pane: PaneT; session?: Session; now: number; focused: boolean; stopCount: number; onFocus: () => void; onClose: () => void; onStop: () => void; style: React.CSSProperties;
}) {
  return (
    <section className={`pane${focused ? " focused" : ""}`} style={style} onMouseDown={onFocus}>
      <PaneHeader pane={pane} session={session} now={now} focused={focused} onClose={onClose} onStop={onStop} />
      <TerminalView paneId={pane.id} focused={focused} agent={pane.agent} stopCount={stopCount} session={session} />
      <PaneFooter session={session} now={now} />
    </section>
  );
}
