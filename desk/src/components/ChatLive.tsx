import { useEffect, useState } from "react";
import { ThinkingOrb } from "thinking-orbs";
import { useIsLight } from "../lib/theme";
import { activityLabel, type ChatState, type ToolItem } from "../lib/chatSession";
import { fmtElapsed } from "../lib/format";
import type { Session } from "../lib/types";
import { activityOf } from "../lib/orbState";

/** One live status row while a turn runs: orb, current activity, elapsed time. Mounted only while running, so the 1 s tick exists only then. */
export default function ChatLive({ state, session }: { state: ChatState; session?: Session }) {
  const light = useIsLight();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const sec = session?.turnStart != null ? Math.max(0, Math.floor(now / 1000) - session.turnStart)
    : state.turnStart == null ? null : Math.max(0, Math.floor((now - state.turnStart) / 1000));
  const tool = [...state.items].reverse().find((i): i is ToolItem => i.kind === "tool" && i.status === "running");
  const a = tool ? activityOf("tool", tool.name) : activityOf("thinking", "");
  return (
    <div className="chat-live" role="status">
      <ThinkingOrb state={a.orb} size={20} theme={light ? "light" : "dark"} />
      <span className="chat-live-label" aria-live="polite">{activityLabel(state)}</span>
      {sec != null && <span className="chat-live-time">{fmtElapsed(sec)}</span>}
    </div>
  );
}
