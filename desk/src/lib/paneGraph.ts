import { useSyncExternalStore } from "react";
import type { SubagentLive } from "./chatSession";
import type { Session } from "./types";
import { sessionTitle } from "./groups";

export interface BgLive { taskId: string; text: string; status: "running" | "done" | "failed"; startedAt?: number; durationS?: number; /** the `bg_` Session behind it, when known */ sessionId?: string; /** that session's current tool (orb) */ tool?: string }
export interface PaneGraphData { subagents: SubagentLive[]; background: BgLive[] }

// Chat-pane subagent/background data, keyed by pane id (ChatState lives inside ChatView only), plus which panes show their graph.
let data: ReadonlyMap<string, PaneGraphData> = new Map();
let open: ReadonlySet<string> = new Set();
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

/** Publish a pane's graph data; empty data clears it. No notification when nothing changed. */
export function setPaneGraph(paneId: string, d: PaneGraphData) {
  const empty = !d.subagents.length && !d.background.length;
  if (empty ? !data.has(paneId) : JSON.stringify(data.get(paneId)) === JSON.stringify(d)) return;
  const m = new Map(data);
  if (empty) m.delete(paneId); else m.set(paneId, d);
  data = m; emit();
}
export const getPaneGraph = () => data;
export const usePaneGraph = () => useSyncExternalStore(subscribe, getPaneGraph);

const setOpen = (paneId: string, on: boolean) => {
  if (open.has(paneId) === on) return;
  const s = new Set(open);
  if (on) s.add(paneId); else s.delete(paneId);
  open = s; emit();
};
export const toggleGraph = (paneId: string) => setOpen(paneId, !open.has(paneId));
export const openGraph = (paneId: string) => setOpen(paneId, true);
export const closeGraph = (paneId: string) => setOpen(paneId, false);
export const getGraphOpen = () => open;
export const useGraphOpen = () => useSyncExternalStore(subscribe, getGraphOpen);

const WORKING = ["running", "thinking", "tool"];
/** Graph data of one pane: chat data when ChatView published any, else hook subagents and `bg_` child sessions. */
export function paneGraphData(chat: PaneGraphData | undefined, session: Session | undefined, kids: Session[]): PaneGraphData {
  if (chat) return { subagents: chat.subagents, background: chat.background.map((b) => (kids.some((k) => k.sessionId === b.taskId) ? { ...b, sessionId: b.taskId, tool: kids.find((k) => k.sessionId === b.taskId)!.tool } : b)) };
  const n = session?.subagents.length ?? 0;
  return {
    subagents: (session?.subagents ?? []).map((a, index) => ({ id: a.id, index, count: n, goal: a.goal, model: "", status: "running", tool: a.tool ?? "", toolPreview: "", toolCount: 0, startAt: a.start * 1000 })),
    background: kids.map((k) => ({ taskId: k.sessionId, sessionId: k.sessionId, tool: k.tool, text: sessionTitle(k), status: WORKING.includes(k.state) ? "running" : "done", startedAt: (k.turnStart ?? k.since) * 1000, durationS: k.lastTurn ?? undefined })),
  };
}

/** Header badge: starting/running subagents + running background tasks. */
export const runningCount = (d: PaneGraphData) => d.subagents.filter((a) => a.status === "starting" || a.status === "running").length + d.background.filter((b) => b.status === "running").length;

export interface GNode { id: string; kind: "root" | "sub" | "bg"; title: string; label?: string; sub?: SubagentLive; bg?: BgLive }

/** Row 0 root; one row per delegate_task call (first-seen order, nodes by index); one background row. */
export function graphRows(root: { title: string; label: string }, subagents: SubagentLive[], background: BgLive[]): GNode[][] {
  const groups = new Map<string, SubagentLive[]>();
  for (const a of subagents) { const k = a.delegationId ?? ""; groups.set(k, [...(groups.get(k) ?? []), a]); }
  return [
    [{ id: "root", kind: "root", title: root.title, label: root.label }],
    ...[...groups.values()].map((g) => [...g].sort((a, b) => a.index - b.index).map((a): GNode => ({ id: a.id, kind: "sub", title: a.goal || a.id, sub: a }))),
    ...(background.length ? [background.map((b): GNode => ({ id: b.taskId, kind: "bg", title: b.text, bg: b }))] : []),
  ];
}

export const NODE_W = 200, NODE_H = 72, ROOT_H = 56, GAP = 12, ROW_GAP = 40, PAD = 16, R = 6;
export interface Laid { nodes: { id: string; x: number; y: number; w: number; h: number }[]; edges: { id: string; d: string }[]; width: number; height: number }

/** Orthogonal polyline with quadratic rounded corners. */
function round(pts: [number, number][]): string {
  const p = pts.filter((q, i) => i === 0 || i === pts.length - 1 ? i === 0 || q[0] !== pts[i - 1][0] || q[1] !== pts[i - 1][1] : !((pts[i - 1][0] === q[0] && q[0] === pts[i + 1][0]) || (pts[i - 1][1] === q[1] && q[1] === pts[i + 1][1])));
  const seg = (a: [number, number], b: [number, number]) => (a[1] === b[1] ? `H${b[0]}` : `V${b[1]}`);
  const len = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
  const toward = (a: [number, number], b: [number, number], d: number): [number, number] => [a[0] + Math.sign(b[0] - a[0]) * d, a[1] + Math.sign(b[1] - a[1]) * d];
  let d = `M${p[0][0]} ${p[0][1]}`;
  for (let i = 1; i < p.length; i++) {
    if (i === p.length - 1) { d += seg(p[i - 1], p[i]); break; }
    const r = Math.min(R, len(p[i - 1], p[i]) / 2, len(p[i], p[i + 1]) / 2), s = toward(p[i], p[i - 1], r), e = toward(p[i], p[i + 1], r);
    d += `${seg(p[i - 1], s)}Q${p[i][0]} ${p[i][1]} ${e[0]} ${e[1]}`;
  }
  return d;
}

/** Rows of nodes (row 0 = root) -> boxes and edges. Rows wrap into centered lines; edges run root bottom-center -> child top-center. */
export function layoutGraph(rows: { id: string }[][], width: number): Laid {
  const inner = width - 2 * PAD, nw = Math.max(120, Math.min(NODE_W, Math.floor((inner - GAP) / 2))); // >= 2 per line once inner >= 252
  const per = Math.max(1, Math.floor((inner + GAP) / (nw + GAP)));
  const nodes: Laid["nodes"] = [];
  const root = rows[0]?.[0];
  if (!root) return { nodes, edges: [], width, height: 2 * PAD };
  nodes.push({ id: root.id, x: (width - nw) / 2, y: PAD, w: nw, h: ROOT_H });
  let y = PAD + ROOT_H;
  const lines: { y: number; first: boolean; ids: string[] }[] = [];
  rows.slice(1).forEach((row, ri) => {
    for (let i = 0; i < row.length; i += per) {
      const line = row.slice(i, i + per);
      y += ROW_GAP;
      const x0 = (width - (line.length * nw + (line.length - 1) * GAP)) / 2;
      line.forEach((n, k) => nodes.push({ id: n.id, x: x0 + k * (nw + GAP), y, w: nw, h: NODE_H }));
      lines.push({ y, first: ri === 0 && i === 0, ids: line.map((n) => n.id) });
      y += NODE_H;
    }
  });
  const rx = width / 2, rb = PAD + ROOT_H;
  // one shared trunk for every later line, just left of the leftmost line start
  const gutter = Math.max(PAD / 2, Math.min(...lines.filter((l) => !l.first).map((l) => nodes.find((n) => n.id === l.ids[0])!.x), Infinity) - 8);
  const edges = lines.flatMap((l) => l.ids.map((id) => {
    const c = nodes.find((n) => n.id === id)!, cx = c.x + c.w / 2;
    const pts: [number, number][] = l.first ? [[rx, rb], [rx, l.y - ROW_GAP / 2], [cx, l.y - ROW_GAP / 2], [cx, l.y]]
      : [[rx, rb], [rx, rb + ROW_GAP / 2], [gutter, rb + ROW_GAP / 2], [gutter, l.y - ROW_GAP / 2], [cx, l.y - ROW_GAP / 2], [cx, l.y]];
    return { id, d: round(pts) };
  }));
  return { nodes, edges, width, height: y + PAD };
}
