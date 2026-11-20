import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleDashed, X, type LucideIcon } from "lucide-react";
import { ThinkingOrb } from "thinking-orbs";
import type { Pane } from "../lib/types";
import { useIsLight } from "../lib/theme";
import { activityOf, type Activity } from "../lib/orbState";
import { fmtElapsed } from "../lib/format";
import { paneIcon } from "../lib/paneIcon";
import { graphRows, layoutGraph, runningCount, type GNode, type PaneGraphData } from "../lib/paneGraph";
import { SubagentDetail } from "./SubagentBlock";

type St = "starting" | "running" | "done" | "failed";

const Orb = ({ a, light }: { a: Activity; light: boolean }) => <ThinkingOrb state={a.orb} size={20} theme={light ? "light" : "dark"} />;

const Run = ({ a, light, text }: { a: Activity; light: boolean; text: string }) => <div className="sg-l2 sg-run"><Orb a={a} light={light} /><span className="ellipsis">{text}</span></div>;

function Card({ n, now, Icon, light, rootAct, kids }: { n: GNode; kids: number; now: number; Icon: LucideIcon; light: boolean; rootAct?: Activity }) {
  if (n.kind === "root") {
    return <><div className="sg-l1"><span className="sg-ico"><Icon size={12} strokeWidth={1.5} /></span><span className="ellipsis">{n.title}</span></div>{rootAct ? <Run a={rootAct} light={light} text={n.label!} /> : <div className="sg-l2 ellipsis">{n.label}</div>}</>;
  }
  const a = n.sub, b = n.bg, st: St = (a?.status ?? b?.status) as St;
  const secs = a ? a.durationSec ?? (a.startAt != null ? (now - a.startAt) / 1000 : null) : b!.durationS ?? (b!.startedAt != null ? (now - b!.startedAt) / 1000 : null);
  const time = secs != null ? fmtElapsed(secs) : "";
  const l2 = st === "starting" ? "Starting" : st === "running" ? (a ? [a.tool, a.toolPreview].filter(Boolean).join(" ") : "") || "Working" : [kids > 0 && `${kids} agent${kids > 1 ? "s" : ""}`, a && a.toolCount > 0 && `${a.toolCount} tools`, time].filter(Boolean).join(" · ") || (st === "failed" ? "Failed" : "Done");
  const tool = a ? a.tool : b!.tool ?? "";
  const model = a ? a.model : "Background";
  return (
    <>
      <div className="sg-l1">
        <span className="sg-ico">{st === "starting" ? <CircleDashed size={12} strokeWidth={1.5} /> : st === "running" ? <span className="dot ok" /> : st === "done" ? <Check size={12} strokeWidth={1.5} style={{ color: "var(--ok)" }} /> : <X size={12} strokeWidth={1.5} style={{ color: "var(--warn)" }} />}</span>
        <span className="ellipsis">{n.title}</span>
      </div>
      {st === "running" ? <Run a={activityOf(tool ? "tool" : "running", tool)} light={light} text={a ? l2 : tool || "Working"} /> : <div className="sg-l2 ellipsis">{l2}</div>}
      {model && <div className="sg-l3"><span className="sg-badge ellipsis">{model}</span></div>}
    </>
  );
}

/** Graph panel docked in a pane: root session -> delegate_task rows -> background tasks. 1 s tick only while something runs. */
export default function SubagentGraph({ pane, rootLabel, title, data, dock, onDock, onClose, onFocusSession, rootAct }: {
  pane: Pane; rootAct?: Activity; rootLabel: string; title: string; data: PaneGraphData; dock: "right" | "bottom"; onDock: (d: "right" | "bottom") => void; onClose: () => void; onFocusSession: (id: string) => void;
}) {
  const running = runningCount(data);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!running) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [running]);
  const [pick, setPick] = useState<string | null>(null);
  const [w, setW] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth)); ro.observe(el); setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const rows = useMemo(() => graphRows({ title, label: rootLabel }, data.subagents, data.background), [title, rootLabel, data]);
  const lay = useMemo(() => layoutGraph(rows, w, dock === "bottom" ? "horizontal" : "vertical"), [rows, w, dock]);
  const byId = new Map(rows.map((n) => [n.id, n]));
  const all = [...data.subagents.map((a) => a.status), ...data.background.map((b) => b.status)];
  const c = (s: string) => all.filter((x) => (s === "running" ? x === "running" || x === "starting" : x === s)).length;
  const head = [c("running") && `${c("running")} running`, c("done") && `${c("done")} done`, c("failed") && `${c("failed")} failed`].filter(Boolean).join(" · ");
  const picked = data.subagents.find((a) => a.id === pick);
  const { Icon } = paneIcon(pane.agent, pane.view), light = useIsLight();
  const el = useRef<HTMLElement>(null);
  const [drop, setDrop] = useState<{ to: "right" | "bottom"; box: React.CSSProperties } | null>(null);
  // drag the header (after 5px) over the pane body: lower 40% -> bottom dock, right 40% -> right dock
  const startDrag = (e: React.PointerEvent) => {
    const body = el.current?.parentElement;
    if (e.button !== 0 || !body || (e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    let on = false, to: "right" | "bottom" | null = null;
    const move = (m: PointerEvent) => {
      if (!on && Math.hypot(m.clientX - sx, m.clientY - sy) < 5) return;
      if (!on) document.body.classList.add("pane-dragging");
      on = true;
      const r = body.getBoundingClientRect(), fx = (m.clientX - r.left) / r.width, fy = (m.clientY - r.top) / r.height;
      to = fy < 0 || fy > 1 || fx < 0 || fx > 1 ? null : fy > 0.6 ? "bottom" : fx > 0.6 && r.width >= 560 ? "right" : null;
      setDrop(to === "bottom" ? { to, box: { left: r.left, top: r.top + r.height / 2, width: r.width, height: r.height / 2 } } : to === "right" ? { to, box: { left: r.right - 360, top: r.top, width: 360, height: r.height } } : null);
    };
    const up = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      document.body.classList.remove("pane-dragging"); setDrop(null);
      if (on && to) onDock(to);
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  const aid = `sg-arrow-${pane.id}`;
  return (
    <aside ref={el} className={`sg ${dock}`} aria-label="Subagents" tabIndex={-1} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <div className="sg-head" onPointerDown={startDrag}><span className="ellipsis">{data.subagents.length || !data.background.length ? "Subagents" : "Background"}{head && ` · ${head}`}</span><span className="grow" /><button className="icon-btn" aria-label="Close" onClick={onClose}><X size={16} strokeWidth={1.5} /></button></div>
      <div className="sg-scroll" ref={box}>
        {w > 0 && (
          <div className="sg-canvas" style={{ width: lay.width, height: lay.height }}>
            <svg width={lay.width} height={lay.height} aria-hidden="true">
              <defs><marker id={aid} markerWidth="5" markerHeight="5" refX="5" refY="2.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0L5 2.5L0 5" fill="none" stroke="var(--text-3)" strokeWidth="1" /></marker></defs>
              {lay.edges.map((e) => <path key={e.id} d={e.d} markerEnd={`url(#${aid})`} />)}
            </svg>
            {lay.nodes.map((b) => {
              const n = byId.get(b.id)!, st = n.sub?.status ?? n.bg?.status ?? "running";
              const cls = `sg-node${n.kind === "root" ? " root" : st === "running" ? "" : " dashed"}${pick === n.id ? " picked" : ""}`;
              const style = { left: b.x, top: b.y, width: b.w, height: b.h };
              const card = <Card n={n} kids={data.subagents.filter((a) => a.parentId === n.id).length} now={now} Icon={Icon} light={light} rootAct={rootAct} />;
              if (n.sub) return <button key={n.id} className={cls} style={style} aria-pressed={pick === n.id} onClick={() => setPick(pick === n.id ? null : n.id)}>{card}</button>;
              if (n.bg?.sessionId) { const sid = n.bg.sessionId; return <button key={n.id} className={cls} style={style} title="세션으로 이동" onClick={() => onFocusSession(sid)}>{card}</button>; }
              return <div key={n.id} className={cls} style={style}>{card}</div>;
            })}
          </div>
        )}
      </div>
      {picked && <div className="sg-detail"><SubagentDetail a={picked} /></div>}
      {drop && <div className="drop-zone" style={drop.box} />}
    </aside>
  );
}
