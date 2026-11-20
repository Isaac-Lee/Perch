import { useLayoutEffect, useRef, useState } from "react";
import type { QueuedMsg } from "../lib/chatSession";

function Card({ q, onSendNow }: { q: QueuedMsg; onSendNow: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState(false);
  useLayoutEffect(() => { const el = ref.current; if (el) setFade(el.scrollHeight > el.clientHeight + 1); }, [q.text]);
  return (
    <div className="chat-queue-card">
      <div className="chat-queue-label">{q.steering ? "전달 중…" : "대기 중"}</div>
      <div ref={ref} className={`chat-queue-text${fade ? " fade" : ""}`} title={q.text}>{q.text}</div>
      <button className="btn chat-queue-send" disabled={!q.admissionId || !q.canSteer || q.steering} title="실행 중인 작업에 바로 전달합니다" onClick={() => onSendNow(q.id)}>지금 보내기</button>
    </div>
  );
}

/** Prompts waiting behind the running turn, floating right above the composer. */
export default function ChatQueue({ queued, onSendNow }: { queued: QueuedMsg[]; onSendNow: (id: string) => void }) {
  return <div className="chat-queue">{queued.map((q) => <Card key={q.id} q={q} onSendNow={onSendNow} />)}</div>;
}
