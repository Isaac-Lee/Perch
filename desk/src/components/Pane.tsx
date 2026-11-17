import type { Pane as PaneT, Session } from "../lib/types";
import PaneHeader from "./PaneHeader";
import PaneFooter from "./PaneFooter";
import TerminalView from "./TerminalView";

export default function Pane({ pane, session, now, focused, onFocus, onClose, style }: {
  pane: PaneT; session?: Session; now: number; focused: boolean; onFocus: () => void; onClose: () => void; style: React.CSSProperties;
}) {
  return (
    <section className={`pane${focused ? " focused" : ""}`} style={style} onMouseDown={onFocus}>
      <PaneHeader pane={pane} session={session} now={now} onClose={onClose} />
      <TerminalView agent={pane.agent} />
      <PaneFooter session={session} now={now} />
    </section>
  );
}
