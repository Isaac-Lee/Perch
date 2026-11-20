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
    subagents: (session?.subagents ?? []).map((a, index) => ({ id: a.id, index, count: n, goal: a.goal, model: "", status: "running", tool: a.tool ?? "", toolPreview: "", toolCount: 0, depth: 0, startAt: a.start * 1000 })),
    background: kids.map((k) => ({ taskId: k.sessionId, sessionId: k.sessionId, tool: k.tool, text: sessionTitle(k), status: WORKING.includes(k.state) ? "running" : "done", startedAt: (k.turnStart ?? k.since) * 1000, durationS: k.lastTurn ?? undefined })),
  };
}

/** Header badge: starting/running subagents + running background tasks. */
export const runningCount = (d: PaneGraphData) => d.subagents.filter((a) => a.status === "starting" || a.status === "running").length + d.background.filter((b) => b.status === "running").length;

export interface GNode { id: string; kind: "root" | "sub" | "bg"; title: string; label?: string; sub?: SubagentLive; bg?: BgLive; /** graph parent node id ("root" for top-level and background) */ parentId?: string; /** 0 root, 1 top-level and background, +1 per nesting */ level: number; /** first node of a new delegation group (top-level, or a sibling with another delegation) or of the background group: extra space above */ gap?: boolean }

/** Flat depth-first list: root; top-level subagents grouped per delegation (first-seen order, then index), each followed by its descendants; background last. */
export function graphRows(root: { title: string; label: string }, subagents: SubagentLive[], background: BgLive[]): GNode[] {
  const ids = new Set(subagents.map((a) => a.id));
  const top = (a: SubagentLive) => !a.parentId || a.parentId === a.id || !ids.has(a.parentId);
  const rank = new Map<string, number>();
  for (const a of subagents) { const k = a.delegationId ?? ""; if (!rank.has(k)) rank.set(k, rank.size); }
  const order = (l: SubagentLive[]) => [...l].sort((a, b) => rank.get(a.delegationId ?? "")! - rank.get(b.delegationId ?? "")! || a.index - b.index);
  const out: GNode[] = [{ id: "root", kind: "root", title: root.title, label: root.label, level: 0 }];
  const seen = new Set<string>(); // guards parent cycles
  const emit = (list: SubagentLive[], parentId: string, level: number) => {
    list.forEach((a, i) => {
      if (seen.has(a.id)) return;
      seen.add(a.id);
      out.push({ id: a.id, kind: "sub", title: a.goal || a.id, sub: a, parentId, level, ...((i === 0 ? level === 1 : a.delegationId !== list[i - 1].delegationId) ? { gap: true } : {}) });
      emit(order(subagents.filter((c) => c.parentId === a.id)), a.id, level + 1);
    });
  };
  emit(order(subagents.filter(top)), "root", 1);
  background.forEach((b, i) => out.push({ id: b.taskId, kind: "bg", title: b.text, bg: b, parentId: "root", level: 1, ...(i === 0 ? { gap: true } : {}) }));
  return out;
}

export const COL_W = 200, ROW_GAP = 32, GAP_X = 16, INDENT = 32, MAX_W = 280, MIN_W = 160, NODE_H = 72, ROOT_H = 56, GAP = 12, GROUP_GAP = 8, PAD = 16, R = 6;
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

/** Flat depth-first list -> one node per line, indented by level. Each edge: parent trunk (x + 12) down from its bottom to the child's vertical center, then right to the child's left edge. */
export function layoutGraph(list: { id: string; parentId?: string; level: number; gap?: boolean }[], width: number, orient: "vertical" | "horizontal" = "vertical"): Laid {
  const nodes: Laid["nodes"] = [];
  if (orient === "horizontal") return layoutSideways(list, width);
  let y = PAD, right = width;
  for (const n of list) {
    const x = PAD + n.level * INDENT, w = Math.max(MIN_W, Math.min(MAX_W, width - x - PAD)), h = n.level === 0 ? ROOT_H : NODE_H;
    if (nodes.length) y += GAP + (n.gap ? GROUP_GAP : 0);
    nodes.push({ id: n.id, x, y, w, h });
    right = Math.max(right, x + w + PAD);
    y += h;
  }
  const at = new Map(nodes.map((n) => [n.id, n]));
  const edges = list.flatMap((n) => {
    const c = at.get(n.id)!, p = n.parentId ? at.get(n.parentId) : undefined;
    if (!p) return [];
    const tx = p.x + 12, cy = c.y + c.h / 2;
    return [{ id: n.id, d: round([[tx, p.y + p.h], [tx, cy], [c.x, cy]]) }];
  });
  return { nodes, edges, width: right, height: y + PAD };
}

/** Bottom dock: one row per level; in depth-first order a node's column is max(parent's column, next free column of its row), so siblings stay evenly spaced and rows never overlap. Edges leave the parent's bottom, run across the row gap and drop onto the child's top. */
function layoutSideways(list: { id: string; parentId?: string; level: number; gap?: boolean }[], width: number): Laid {
  const H = NODE_H, xs = new Map<string, number>(), free: number[] = [], used: boolean[] = [];
  for (const n of list) {
    const f = (free[n.level] ?? PAD) + (n.gap && used[n.level] ? GROUP_GAP : 0), x = Math.max(f, xs.get(n.parentId ?? "") ?? PAD);
    xs.set(n.id, x); free[n.level] = x + COL_W + GAP_X; used[n.level] = true;
  }
  const nodes: Laid["nodes"] = list.map((n) => ({ id: n.id, x: xs.get(n.id)!, y: PAD + n.level * (H + ROW_GAP), w: COL_W, h: n.level === 0 ? ROOT_H : H }));
  const right = Math.max(...nodes.map((n) => n.x + n.w)), bottom = Math.max(...nodes.map((n) => n.y + H));
  const at = new Map(nodes.map((n) => [n.id, n]));
  const edges = list.flatMap((n) => {
    const c = at.get(n.id)!, p = n.parentId ? at.get(n.parentId) : undefined;
    if (!p) return [];
    const my = c.y - ROW_GAP / 2;
    return [{ id: n.id, d: round([[p.x + 16, p.y + p.h], [p.x + 16, my], [c.x + 16, my], [c.x + 16, c.y]]) }];
  });
  return { nodes, edges, width: Math.max(width, right + PAD), height: bottom + PAD };
}
