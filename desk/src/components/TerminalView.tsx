import type { AgentKind, Session } from "../lib/types";
import { isTauri } from "../lib/backend";
import MockTerminalView from "./MockTerminalView";
import PtyTerminalView from "./PtyTerminalView";

export default function TerminalView({ paneId, focused, agent, stopCount, session }: { paneId: string; focused: boolean; agent: AgentKind; stopCount?: number; session?: Session }) {
  return isTauri ? <PtyTerminalView paneId={paneId} focused={focused} agent={agent} /> : <MockTerminalView agent={agent} stopCount={stopCount} session={session} />;
}
