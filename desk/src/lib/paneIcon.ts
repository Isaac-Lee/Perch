import { Bot, MessageSquare, SquareTerminal, Terminal, type LucideIcon } from "lucide-react";
import type { AgentKind, PaneView } from "./types";

/** One icon per kind of pane, shared by the pane header and the New session menu.
 *  `view` is only set for hermes panes (see addPane in useTauriDesk); mock panes never set it, so
 *  anything but "chat" counts as the terminal view. */
export function paneIcon(agent: AgentKind, view?: PaneView): { Icon: LucideIcon; title: string } {
  if (agent === "hermes") return view === "chat" ? { Icon: MessageSquare, title: "채팅 보기" } : { Icon: SquareTerminal, title: "터미널(TUI) 보기" };
  return agent === "opencode" ? { Icon: Bot, title: "OpenCode" } : { Icon: Terminal, title: "셸" };
}
