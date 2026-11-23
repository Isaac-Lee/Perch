import type { AgentKind, PaneView, Session } from "../lib/types";
import { isTauri } from "../lib/backend";
import ChatView from "./ChatView";
import MockTerminalView from "./MockTerminalView";
import PtyTerminalView from "./PtyTerminalView";

export default function TerminalView({ paneId, focused, agent, stopCount, session, view, cwd, sessionId }: { paneId: string; focused: boolean; agent: AgentKind; stopCount?: number; session?: Session; view?: PaneView; cwd?: string; sessionId?: string | null }) {
  if (isTauri && view === "chat") return <ChatView paneId={paneId} cwd={cwd ?? ""} sessionId={sessionId ?? null} focused={focused} session={session} />;
  return isTauri ? <PtyTerminalView paneId={paneId} focused={focused} agent={agent} /> : <MockTerminalView agent={agent} stopCount={stopCount} session={session} />;
}
