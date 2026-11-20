import { useEffect, useState } from "react";
import { Check, ChevronRight } from "lucide-react";
import type { SubagentLive } from "../lib/chatSession";
import { fmtElapsed } from "../lib/format";
import { fmtTok } from "../lib/usage";

export const active = (a: SubagentLive) => a.status === "starting" || a.status === "running";

/** Expanded body of one child: failure, summary, tokens, last output. */
export function SubagentDetail({ a }: { a: SubagentLive }) {
  return (
    <div className="chat-tool-body">
      {a.status === "failed" && <div className="chat-tool-failed">Failed</div>}
      {a.summary && <div className="chat-tool-summary">{a.summary}</div>}
      {a.tokens && <div className="chat-tool-summary">{fmtTok(a.tokens.in + a.tokens.out)}</div>}
      {a.outputTail?.length ? (
        <pre className="chat-tool-result">{a.outputTail.map((o, i) => <div key={i} className={o.isError ? "chat-tool-failed" : undefined}>{`${o.isError ? "✕ " : ""}${o.tool} ${o.preview.slice(0, 300)}`}</div>)}</pre>
      ) : !a.summary && <div className="chat-tool-summary">{active(a) ? "아직 진행 중입니다" : "남은 출력이 없습니다"}</div>}
    </div>
  );
}

function Child({ a, now }: { a: SubagentLive; now: number }) {
  const [open, setOpen] = useState(false);
  const secs = a.durationSec ?? (a.startAt != null ? (now - a.startAt) / 1000 : null);
  const cur = active(a) && a.tool ? [a.tool, a.toolPreview].filter(Boolean).join(" ") : "";
  return (
    <div className="chat-sub">
      <button className="chat-tool-row chat-sub-row" onClick={() => setOpen(!open)} aria-expanded={open}>
        <ChevronRight className={"chat-chev" + (open ? " open" : "")} size={12} strokeWidth={1.75} />
        {a.status === "done" ? <Check className="chat-sub-ok" size={12} strokeWidth={1.75} /> : <span className={`dot ${a.status === "failed" ? "warn" : "ok"} chat-sub-dot`} />}
        <span className={"chat-sub-goal" + (a.status === "failed" ? " chat-tool-failed" : "")}>{a.goal || a.id}</span>
        {cur && <span className="chat-sub-cur">{cur}</span>}
        {a.toolCount > 0 && <span className="chat-sub-meta">{a.toolCount} tool{a.toolCount > 1 ? "s" : ""}</span>}
        {secs != null && <span className="chat-sub-meta">{fmtElapsed(secs)}</span>}
      </button>
      {open && <SubagentDetail a={a} />}
    </div>
  );
}

/** Children of one delegate_task call. The 1 s tick exists only while one still runs. */
export default function SubagentBlock({ ids, subagents }: { ids: string[]; subagents: Record<string, SubagentLive> }) {
  const list = ids.map((i) => subagents[i]).filter((a): a is SubagentLive => !!a);
  const running = list.filter(active).length;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!running) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [running]);
  if (!list.length) return null;
  const done = list.filter((a) => a.status === "done").length, failed = list.length - running - done;
  const head = [running && `${running} running`, done && `${done} done`, failed && `${failed} failed`].filter(Boolean).join(" · ");
  return (
    <div className="chat-subs">
      <div className="chat-subs-head">Subagents · {head}</div>
      {list.map((a) => <Child key={a.id} a={a} now={now} />)}
    </div>
  );
}
