import { useState } from "react";
import { openUrl } from "../lib/backend";
import type { ChatItem } from "../lib/chatSession";
import { Markdown } from "../lib/markdown";

const STATUS = { running: "◌ 실행 중", done: "✓ 완료", error: "✕ 오류" } as const;

export default function ChatMessage({ item }: { item: ChatItem }) {
  const [open, setOpen] = useState(false);
  switch (item.kind) {
    case "user":
      return <div className="chat-user"><div className="chat-bubble">{item.text}{item.images?.length ? <div className="chat-bubble-img">이미지 {item.images.length}개</div> : null}</div></div>;
    case "assistant":
      return (
        <div className="chat-assistant">
          <Markdown text={item.text} onLink={(u) => { openUrl(u).catch(console.error); }} />
          {item.streaming && <span className="chat-cursor" />}
        </div>
      );
    case "tool": {
      const parts = [item.name, item.context, STATUS[item.status], item.durationS != null ? `${item.durationS.toFixed(1)}s` : ""].filter(Boolean);
      return (
        <div className={`chat-tool ${item.status}`}>
          <button className="chat-tool-row" onClick={() => setOpen(!open)} aria-expanded={open}>{parts.join(" · ")}</button>
          {open && item.result && <pre className="chat-tool-result">{item.result.slice(0, 2000)}</pre>}
        </div>
      );
    }
    case "error":
      return <div className="chat-error">{item.text}</div>;
  }
}
