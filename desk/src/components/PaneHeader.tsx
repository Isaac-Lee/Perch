import { X } from "lucide-react";
import { ThinkingOrb } from "thinking-orbs";
import type { Pane, Session } from "../lib/types";
import { displayState } from "../lib/groups";
import { fmtElapsed } from "../lib/format";
import { agentName } from "./SessionRow";

export default function PaneHeader({ pane, session, now, onClose }: { pane: Pane; session?: Session; now: number; onClose: () => void }) {
  const st = session ? displayState(session, now) : null;
  const waiting = session?.pending && (st === "approval" || st === "question");
  return (
    <div className={`pane-head${waiting ? " warn" : ""}`}>
      <span className="pane-title">{agentName(pane.agent)} · {pane.title}</span>
      {waiting ? <span className="pane-note ellipsis">{st === "approval" ? "승인 필요" : "질문"} · {session!.pending!.text}</span> : <span className="grow" />}
      {st === "thinking" && session && (
        <span className="think">
          <ThinkingOrb state="working" size={20} theme="dark" />
          <span>생각 중 {fmtElapsed(now - session.since)}</span>
        </span>
      )}
      <button className="icon-btn" aria-label="칸 닫기" onClick={onClose}><X size={16} strokeWidth={1.5} /></button>
    </div>
  );
}
