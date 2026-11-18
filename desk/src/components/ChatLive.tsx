import { useEffect, useState } from "react";
import { ThinkingOrb } from "thinking-orbs";
import { activityLabel, fmtSec, type ChatState } from "../lib/chatSession";

/** One live status row while a turn runs: orb, current activity, elapsed time. Mounted only while running, so the 1 s tick exists only then. */
export default function ChatLive({ state }: { state: ChatState }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const sec = state.turnStart == null ? null : Math.max(0, Math.floor((now - state.turnStart) / 1000));
  return (
    <div className="chat-live" role="status">
      <ThinkingOrb state="working" size={20} theme="dark" />
      <span className="chat-live-label" aria-live="polite">{activityLabel(state)}</span>
      {sec != null && <span className="chat-live-time">{fmtSec(sec)}</span>}
    </div>
  );
}
