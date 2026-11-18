import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { openUrl } from "../lib/backend";
import type { ChatItem, ToolGroup } from "../lib/chatSession";
import { Markdown } from "../lib/markdown";

const STATUS = { running: "실행 중", done: "", error: "✕ 오류" } as const;

export default function ChatMessage({ item }: { item: ChatItem | ToolGroup }) {
  const [open, setOpen] = useState(false);
  switch (item.kind) {
    case "user":
      return <div className="chat-user"><div className="chat-bubble">{item.text}{item.images?.length ? <div className="chat-bubble-img">이미지 {item.images.length}개</div> : null}</div></div>;
    case "assistant":
      return (
        <div className="chat-assistant">
          <Markdown text={item.text} onLink={(u) => { openUrl(u).catch(console.error); }} />
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
    case "tools": {
      const last = item.items[item.items.length - 1], failed = item.items.filter((t) => t.status === "error").length;
      const secs = item.items.every((t) => t.durationS != null) ? item.items.reduce((n, t) => n + (t.durationS ?? 0), 0) : null;
      return (
        <div className="chat-tool chat-tools">
          <button className="chat-tool-row" onClick={() => setOpen(!open)} aria-expanded={open}>
            <ChevronRight className={"chat-chev" + (open ? " open" : "")} size={12} strokeWidth={1.75} />
            {[`도구 ${item.items.length}개`, [last.name, last.context].filter(Boolean).join(" ")].join(" · ")}
            {failed > 0 && <span className="chat-tool-failed"> · 오류 {failed}</span>}
            {secs != null && ` · ${secs.toFixed(1)}s`}
          </button>
          {open && <div className="chat-tools-body">{item.items.map((t) => <ChatMessage key={t.id} item={t} />)}</div>}
        </div>
      );
    }
    case "error":
      return <div className="chat-error">{item.text}</div>;
    case "system":
      return <div className="chat-system"><Markdown text={item.text} onLink={(u) => { openUrl(u).catch(console.error); }} /></div>;
  }
}
