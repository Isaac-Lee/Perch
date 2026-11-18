import type { Pane as PaneT, Session } from "../lib/types";
import PaneHeader from "./PaneHeader";
import PaneFooter from "./PaneFooter";
import TerminalView from "./TerminalView";

export default function Pane({ pane, session, now, focused, stopCount, onFocus, onClose, onStop, style, dragging, onDragStart }: {
  pane: PaneT; session?: Session; now: number; focused: boolean; stopCount: number; onFocus: () => void; onClose: () => void; onStop: () => void; style: React.CSSProperties;
  dragging?: boolean; onDragStart?: (e: React.PointerEvent<HTMLElement>) => void;
}) {
  return (
    <section className={`pane${focused ? " focused" : ""}`} style={style} data-pane-id={pane.id} onMouseDown={onFocus}>
      <PaneHeader pane={pane} session={session} now={now} focused={focused} onClose={onClose} onStop={onStop} dragging={dragging} onDragStart={onDragStart} />
      <TerminalView paneId={pane.id} focused={focused} agent={pane.agent} stopCount={stopCount} session={session} view={pane.view} cwd={pane.cwd} sessionId={pane.sessionId} />
      <PaneFooter session={session} now={now} />
    </section>
  );
}
