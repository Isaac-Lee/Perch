import { memo, useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { openUrl } from "../lib/backend";
import { fmtSec, type ChatItem, type SubagentLive, type ToolGroup, type ToolItem } from "../lib/chatSession";
import { highlight } from "../lib/highlight";
import { Markdown } from "../lib/markdown";
import SubagentBlock from "./SubagentBlock";
import { kvRows, resultCount, resultView, thoughtTitle, toolTitle } from "../lib/toolView";

export type ChatActions = {
  state: { show: boolean; enabled: boolean; reason?: string };
  onRewind: () => void;
  onOverwrite: (text: string) => void;
  onFork: (text: string, sendNow: boolean) => void;
};

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

/** User bubble: text plus hover/focus actions (rewind, edit, fork) with an inline confirm like SettingsMenu's restart ask. */
function UserBubble({ item, actions }: { item: Extract<ChatItem, { kind: "user" }>; actions?: ChatActions }) {
  const [mode, setMode] = useState<"" | "edit" | "ask-rewind" | "ask-overwrite">("");
  const [draft, setDraft] = useState(item.text);
  const a = actions?.state;
  const off = !a?.enabled, why = a?.reason;
  const done = () => setMode("");
  const confirm = (go: () => void) => (
    <div className="chat-act-confirm" role="alert">
      <span>이 메시지와 그 뒤 대화가 지워집니다. 되돌릴 수 없습니다</span>
      <button className="btn" disabled={off} title={off ? why : undefined} onClick={() => { done(); go(); }}>확인</button>
      <button className="btn" onClick={() => setMode(mode === "ask-overwrite" ? "edit" : "")}>취소</button>
    </div>
  );
  return (
    <div className="chat-user">
      <div className="chat-bubble-wrap">
        {mode === "edit" || mode === "ask-overwrite" ? (
          <div className="chat-edit">
            <textarea className="chat-edit-text" value={draft} autoFocus rows={Math.min(8, draft.split("\n").length + 1)} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") done(); }} />
            {mode === "ask-overwrite" ? confirm(() => actions?.onOverwrite(draft)) : (
              <div className="chat-act-row">
                <button className="btn" disabled={off || !draft.trim()} title={off ? why : "이 메시지부터 덮어씁니다"} onClick={() => setMode("ask-overwrite")}>여기서 덮어쓰기</button>
                <button className="btn" disabled={off || !draft.trim()} title={off ? why : "새 세션으로 포크해 보냅니다"} onClick={() => { done(); actions?.onFork(draft, true); }}>포크해서 보내기</button>
                <button className="btn" onClick={done}>취소</button>
              </div>
            )}
          </div>
        ) : (
          <div className="chat-bubble">{item.text}{item.images?.length ? <div className="chat-bubble-img">이미지 {item.images.length}개</div> : null}</div>
        )}
        {a?.show && mode === "" && <div className="chat-acts">
          <button className="chat-act" disabled={off} title={off ? why : "이 메시지 직전으로 되감기"} onClick={() => setMode("ask-rewind")}>⟲ 되감기</button>
          <button className="chat-act" disabled={off} title={off ? why : "메시지 편집"} onClick={() => { setDraft(item.text); setMode("edit"); }}>✎ 편집</button>
          <button className="chat-act" disabled={off} title={off ? why : "여기서 새 세션으로 포크"} onClick={() => actions?.onFork(item.text, false)}>⑂ 포크</button>
        </div>}
        {mode === "ask-rewind" && confirm(() => actions?.onRewind())}
      </div>
    </div>
  );
}

const BG_STATUS = { running: "Running", done: "Done", failed: "Failed" } as const;

/** A `/background` run: one compact row, click for the result. Never part of the parent turn. */
function BackgroundRow({ item }: { item: Extract<ChatItem, { kind: "background" }> }) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const running = item.status === "running";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  const secs = running ? (item.startedAt != null ? Math.round((now - item.startedAt) / 1000) : null) : item.durationS ?? null;
  const parts = [`Background · ${item.text}`, BG_STATUS[item.status], secs != null ? fmtSec(Math.max(0, secs)) : ""].filter(Boolean);
  return (
    <div className={`chat-tool ${item.status === "failed" ? "error" : item.status}`}>
      <button className="chat-tool-row" onClick={() => setOpen(!open)} aria-expanded={open} title="다른 세션에서 실행 중인 백그라운드 작업입니다.">
        <ChevronRight className={"chat-chev" + (open ? " open" : "")} size={12} strokeWidth={1.75} />{parts.join(" · ")}
      </button>
      {open && (item.result ? <div className="chat-thought-body"><Markdown text={item.result} onLink={(u) => { openUrl(u).catch(console.error); }} /></div> : <div className="chat-thought-body">아직 결과가 없습니다.</div>)}
    </div>
  );
}

function ChatMessage({ item, subagents, actions }: { item: ChatItem | ToolGroup; subagents?: Record<string, SubagentLive>; actions?: ChatActions }) {
  const [open, setOpen] = useState(false);
  switch (item.kind) {
    case "user":
      return <UserBubble item={item} actions={actions} />;
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
          {item.subagentIds?.length && subagents ? <SubagentBlock ids={item.subagentIds} subagents={subagents} /> : null}
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
    case "background":
      return <BackgroundRow item={item} />;
    case "error":
      return <div className="chat-error">{item.text}</div>;
    case "system":
      return <div className="chat-system"><Markdown text={item.text} onLink={(u) => { openUrl(u).catch(console.error); }} /></div>;
  }
}

export default memo(ChatMessage);
