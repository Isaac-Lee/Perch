import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { openUrl } from "../lib/backend";
import { fmtSec, type ChatItem, type ToolGroup, type ToolItem } from "../lib/chatSession";
import { highlight } from "../lib/highlight";
import { Markdown } from "../lib/markdown";
import { kvRows, resultCount, resultView, thoughtTitle, toolTitle } from "../lib/toolView";

const STATUS = { running: "실행 중", done: "", error: "✕ 오류" } as const;

const Rows = ({ rows }: { rows: [string, string][] }) => rows.length ? <dl className="chat-kv">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl> : null;

/** Expanded view of one tool call: summary, arguments, inline diff, result. */
function ToolDetails({ t }: { t: ToolItem }) {
  const res = resultView(t.result, t.resultText);
  return (
    <div className="chat-tool-body">
      {t.summary && <div className="chat-tool-summary">{t.summary}</div>}
      <Rows rows={kvRows(t.args)} />
      {t.diff && <pre className="chat-tool-result"><code>{highlight("diff", t.diff.slice(0, 20000)).map((k, i) => (k.t ? <span key={i} className={"hl-" + k.t}>{k.s}</span> : k.s))}</code></pre>}
      <Rows rows={res.rows} />
      {res.text && <pre className="chat-tool-result">{res.text.slice(0, 2000)}</pre>}
    </div>
  );
}

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
    case "thought": {
      const title = thoughtTitle(item.text);
      const parts = ["생각", title, item.durationS ? fmtSec(item.durationS) : ""].filter(Boolean);
      return (
        <div className="chat-tool chat-thought">
          <button className="chat-tool-row" onClick={() => setOpen(!open)} aria-expanded={open}>
            <ChevronRight className={"chat-chev" + (open ? " open" : "")} size={12} strokeWidth={1.75} />{parts.join(" · ")}
          </button>
          {open && <div className="chat-thought-body"><Markdown text={item.text} onLink={(u) => { openUrl(u).catch(console.error); }} /></div>}
        </div>
      );
    }
    case "tool": {
      const count = item.status === "done" ? resultCount(item.result) : null;
      const parts = [toolTitle(item), count ? `${count}개` : "", STATUS[item.status], item.durationS != null ? `${item.durationS.toFixed(1)}s` : ""].filter(Boolean);
      return (
        <div className={`chat-tool ${item.status}`}>
          <button className="chat-tool-row" onClick={() => setOpen(!open)} aria-expanded={open}>
            <ChevronRight className={"chat-chev" + (open ? " open" : "")} size={12} strokeWidth={1.75} />{parts.join(" · ")}
          </button>
          {open && <ToolDetails t={item} />}
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
            {`도구 ${item.items.length}개 · ${toolTitle(last)}`}
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
