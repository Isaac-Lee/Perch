import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { chatClose, chatConnect, chatSend, paneSetSession, sessionForceIdle } from "./backend";
import { BLOCKED_SLASH, imageExt, isSlashCommand, parseModelArg, parseSlash, toBase64 } from "./composer";
import { createRpc, type Rpc } from "./gateway";
import type { GatewayEvent, SessionSnapshot } from "./gatewayTypes";

export type ChatItem =
  | { kind: "user"; id: string; text: string; images?: string[] }
  | { kind: "assistant"; id: string; text: string; streaming: boolean }
  | { kind: "thought"; id: string; text: string; streaming: boolean; startedAt?: number; durationS?: number }
  | {
    kind: "tool"; id: string; name: string; context: string; status: "running" | "done" | "error"; durationS?: number; result?: string;
    summary?: string; preview?: string; args?: Record<string, unknown>; resultText?: string; diff?: string; labels?: string[]; progress?: string;
    /** delegate_task only: `subagent_id`s of the children it spawned (see ChatState.subagents) */ subagentIds?: string[];
  }
  | { kind: "background"; id: string; taskId: string; text: string; status: "running" | "done" | "failed"; result?: string; startedAt?: number; durationS?: number }
  | { kind: "error"; id: string; text: string }
  | { kind: "system"; id: string; text: string };
export interface ChatPrompt {
  kind: "approval" | "clarify"; promptId: string; executionGeneration: number; choices: string[];
  command?: string; description?: string; question?: string; multiSelect?: boolean;
  /** clarify batch with several questions: shown as text, answered with one free-text reply */
  questions?: string[];
}
/** One child of a delegate_task call, fed by subagent.* frames (they keep coming after the parent turn ended). */
export interface SubagentLive {
  id: string; delegationId?: string; index: number; count: number; goal: string; model: string; status: "starting" | "running" | "done" | "failed";
  tool: string; toolPreview: string; toolCount: number; /** `at` of the first frame seen (ms epoch), null when the dispatcher passed none */ startAt: number | null;
  durationSec?: number; summary?: string; tokens?: { in: number; out: number }; outputTail?: { tool: string; preview: string; isError: boolean }[];
}
export interface ChatState { conn: "connecting" | "ready" | "closed" | "error"; error?: string; sessionId: string | null; executionGeneration: number; revision: number; running: boolean; items: ChatItem[]; prompts: ChatPrompt[]; model: string | null; effort: string | null; /** ms epoch the current turn began; set from timestamps the dispatcher passes in (the reducer stays pure) */ turnStart: number | null; /** Hermes status line (thinking.delta) */ status: string; /** tool named by tool.generating, before its tool.start */ generating: string;
  /** `at` of a local prompt that has not seen message.start yet (the optimistic window); null otherwise */ sentAt: number | null;
  /** the user cleared a stuck indicator by hand: the next real frame turns it back on */ cleared: boolean;
  /** delegate_task children by subagent_id. Not in session.resume snapshots: after a resume/reconnect only children seen live exist. */ subagents: Record<string, SubagentLive> }
export const initialChat: ChatState = { conn: "connecting", sessionId: null, executionGeneration: 0, revision: 0, running: false, items: [], prompts: [], model: null, effort: null, turnStart: null, status: "", generating: "", sentAt: null, cleared: false, subagents: {} };
export type ChatAction =
  | { t: "conn"; conn: ChatState["conn"]; error?: string }
  | { t: "snapshot"; snap: any; at?: number }
  | { t: "modelChanged"; revision: number; executionGeneration: number; model: string }
  | { t: "effortChanged"; revision: number; executionGeneration: number; effort: string }
  | { t: "effort"; effort: string }
  | { t: "system"; text: string }
  /** prompt.background accepted: a separate Hermes session `taskId` runs `text` */
  | { t: "background"; taskId: string; text: string; at?: number }
  /** Stop pressed twice on a turn Hermes will not end: drop Perch's indicators only */
  | { t: "clear" }
  | { t: "promptDone"; promptId: string }
  | { t: "userSent"; id: string; text: string; images?: string[]; /** set for a real prompt (not a slash command): starts the turn clock at once */ at?: number }
  | { t: "event"; ev: GatewayEvent; at?: number };

const str = (v: unknown) => (typeof v === "string" ? v : "");

function callContext(args: unknown): string {
  try {
    const o = JSON.parse(str(args));
    const v = typeof o?.command === "string" ? o.command : Object.values(o ?? {}).find((x) => typeof x === "string");
    return typeof v === "string" ? v.slice(0, 120) : "";
  } catch { return ""; }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const labelsOf = (v: unknown) => { const l = (Array.isArray(v) ? v : []).map((x) => str((x as any)?.text)).filter(Boolean); return l.length ? { labels: l } : {}; };
/** Optional tool fields shared by tool.start / tool.complete payloads; absent ones stay absent so a patch never erases earlier data. */
const toolExtra = (p: any) => ({
  ...(isObj(p.args) ? { args: p.args } : {}), ...(str(p.preview) ? { preview: p.preview } : {}), ...(str(p.summary) ? { summary: p.summary } : {}),
  ...(str(p.result_text) ? { resultText: p.result_text } : {}), ...(str(p.inline_diff) ? { diff: p.inline_diff } : {}), ...labelsOf(p.labels),
});

// session.resume rows are raw model-API messages (user / assistant+tool_calls / tool).
export function transcriptToItems(messages: any[]): ChatItem[] {
  const out: ChatItem[] = [];
  let calls: any[] = [];
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    const id = `h${out.length}`;
    const text = typeof m.text === "string" ? m.text : typeof m.content === "string" ? m.content : "";
    if (m.role === "user") out.push({ kind: "user", id, text });
    else if (m.role === "assistant") {
      calls = Array.isArray(m.tool_calls) ? m.tool_calls : [];
      const reasoning = str(m.reasoning) || str(m.reasoning_content);
      if (reasoning.trim()) out.push({ kind: "thought", id: `r${out.length}`, text: reasoning, streaming: false });
      if (text.trim()) out.push({ kind: "assistant", id: `h${out.length}`, text, streaming: false });
    } else if (m.role === "tool") {
      const call = calls.find((c) => c && (c.id === m.tool_call_id || c.call_id === m.tool_call_id));
      out.push({
        kind: "tool", id, name: str(m.tool_name) || str(m.name), context: str(m.context) || callContext(call?.function?.arguments),
        status: "done", ...(typeof m.content === "string" ? { result: m.content } : {}),
        ...(isObj(m.args) ? { args: m.args } : {}), ...labelsOf(m.labels),
      });
    }
  }
  return out;
}

// Event payloads and session.resume snapshot rows share one shape (CanonicalPendingPrompt).
export function toPrompt(p: any, kind: string): ChatPrompt | null {
  if (!p || typeof p !== "object" || !str(p.prompt_id) || typeof p.execution_generation !== "number") return null;
  if (kind !== "approval" && kind !== "clarify") return null;
  const choices: string[] = Array.isArray(p.choices) ? p.choices.filter((c: unknown) => typeof c === "string") : [];
  const out: ChatPrompt = { kind, promptId: p.prompt_id, executionGeneration: p.execution_generation, choices };
  if (kind === "approval") return { ...out, command: str(p.command), description: str(p.description) };
  const qs: any[] = (Array.isArray(p.questions) ? p.questions : []).filter((q: any) => str(q?.question).trim());
  if (qs.length === 1) return { ...out, question: qs[0].question.trim(), choices: Array.isArray(qs[0].choices) ? qs[0].choices.filter((c: unknown) => typeof c === "string") : [], multiSelect: qs[0].multi_select === true };
  if (qs.length > 1) return { ...out, questions: qs.map((q) => q.question.trim()) };
  const question = str(p.question).trim();
  return question ? { ...out, question, multiSelect: p.multi_select === true } : null;
}

const addPrompt = (s: ChatState, pr: ChatPrompt | null): ChatState =>
  !pr || s.prompts.some((x) => x.promptId === pr.promptId) ? s : { ...s, prompts: [...s.prompts, pr] };
const dropPrompt = (s: ChatState, id: string): ChatState =>
  s.prompts.some((x) => x.promptId === id) ? { ...s, prompts: s.prompts.filter((x) => x.promptId !== id) } : s;

export function chatReducer(s: ChatState, a: ChatAction): ChatState {
  switch (a.t) {
    case "conn": return { ...s, conn: a.conn, error: a.error };
    case "snapshot": return {
      ...s, conn: "ready", error: undefined, sessionId: a.snap.session_id ?? null,
      executionGeneration: typeof a.snap.execution_generation === "number" ? a.snap.execution_generation : s.executionGeneration,
      revision: typeof a.snap.revision === "number" ? a.snap.revision : 0,
      sentAt: null, cleared: false, running: !!a.snap.running, turnStart: a.snap.running ? s.turnStart ?? a.at ?? null : null, model: a.snap.info?.model || s.model, effort: str(a.snap.info?.reasoning_effort) || s.effort, items: transcriptToItems(a.snap.messages ?? []), prompts: (Array.isArray(a.snap.prompts) ? a.snap.prompts : []).map((p: any) => toPrompt(p, p?.kind)).filter((p: ChatPrompt | null): p is ChatPrompt => !!p),
    };
    case "modelChanged": return { ...s, revision: a.revision, executionGeneration: a.executionGeneration, model: a.model };
    case "effortChanged": return { ...s, revision: a.revision, executionGeneration: a.executionGeneration, effort: a.effort };
    case "effort": return s.effort ? s : { ...s, effort: a.effort };
    case "system": return { ...s, items: [...settle(s.items), { kind: "system", id: `s${s.items.length}`, text: a.text }] };
    case "background": return s.items.some((i) => i.kind === "background" && i.taskId === a.taskId) ? s
      : { ...s, items: [...s.items, { kind: "background", id: `bg-${a.taskId}`, taskId: a.taskId, text: a.text, status: "running", startedAt: a.at }] };
    case "clear": return { ...endTurn(s), cleared: true };
    case "promptDone": return dropPrompt(s, a.promptId);
    case "userSent": return {
      ...s, items: [...settle(s.items), { kind: "user", id: a.id, text: a.text, images: a.images }],
      ...(a.at != null && !s.running ? { running: true, turnStart: a.at, sentAt: a.at, cleared: false } : {}),
    };
    case "event": {
      if (a.ev.type.startsWith("subagent.")) return subagentEvent(s, a.ev, a.at);
      if (a.ev.type === "background.complete") return backgroundDone(s, a.ev, a.at);
      const n = onEvent(typeof a.ev.execution_generation === "number" ? { ...s, executionGeneration: a.ev.execution_generation } : s, a.ev, a.at);
      if (a.ev.type === "message.start") return { ...n, turnStart: s.turnStart ?? a.at ?? null, sentAt: null, cleared: false };
      if (a.ev.type === "message.complete" || a.ev.type === "error") return { ...n, turnStart: null, sentAt: null, cleared: false };
      // after a manual clear, the next sign of life from Hermes turns the indicator back on
      if (n.running && !s.running && n.turnStart == null) return { ...n, turnStart: a.at ?? null, cleared: false };
      return n;
    }
  }
}

/** background.complete touches only the matching background item: never running or the turn clock. Unknown task ids are ignored. */
function backgroundDone(s: ChatState, ev: GatewayEvent, at?: number): ChatState {
  const p = ev.payload ?? {}, id = str(p.task_id), text = str(p.text);
  if (!s.items.some((i) => i.kind === "background" && i.taskId === id)) return s;
  return { ...s, items: s.items.map((i) => i.kind === "background" && i.taskId === id ? {
    ...i, status: /^error:/i.test(text) ? "failed" : "done", result: text, ...(i.startedAt != null && at != null ? { durationS: Math.max(0, Math.round((at - i.startedAt) / 1000)) } : {}),
  } : i) };
}

/** subagent.* frames touch only `subagents` and the delegate_task item's `subagentIds`: never running, turn clock or item order. */
function subagentEvent(s: ChatState, ev: GatewayEvent, at?: number): ChatState {
  const p = ev.payload ?? {};
  const id = str(p.subagent_id);
  if (!id) return s;
  const num = (v: unknown, d = 0) => (typeof v === "number" ? v : d);
  const known = s.subagents[id];
  const cur: SubagentLive = known ?? {
    id, index: num(p.task_index), count: num(p.task_count, 1), goal: "", model: "", status: "starting", tool: "", toolPreview: "", toolCount: 0, startAt: at ?? null,
  };
  const over = cur.status === "done" || cur.status === "failed";
  const n: SubagentLive = {
    ...cur, goal: str(p.goal) || cur.goal, model: str(p.model) || cur.model, toolCount: Math.max(cur.toolCount, num(p.tool_count)),
    ...(str(p.delegation_id) ? { delegationId: p.delegation_id } : {}),
    ...(ev.type === "subagent.spawn_requested" || over ? {} : { status: "running" as const }),
  };
  if (ev.type === "subagent.tool") { n.tool = str(p.tool_name); n.toolPreview = str(p.tool_preview) || str(p.text); }
  if (ev.type === "subagent.complete") {
    n.status = str(p.status) === "completed" ? "done" : "failed";
    n.tool = ""; n.toolPreview = "";
    if (typeof p.duration_seconds === "number") n.durationSec = p.duration_seconds;
    if (str(p.summary)) n.summary = p.summary;
    n.tokens = { in: num(p.input_tokens), out: num(p.output_tokens) };
    n.outputTail = (Array.isArray(p.output_tail) ? p.output_tail : []).map((o: any) => ({ tool: str(o?.tool), preview: str(o?.preview), isError: o?.is_error === true }));
  }
  let items = s.items;
  if (!known && !items.some((i) => i.kind === "tool" && i.subagentIds?.includes(id))) {
    let at2 = -1;
    for (let k = items.length - 1; k >= 0; k--) { const i = items[k]; if (i.kind === "tool" && i.name === "delegate_task") { at2 = k; break; } }
    const host = items[at2];
    if (host?.kind === "tool" && (host.subagentIds?.length ?? 0) < n.count) items = items.map((i, k) => (k === at2 ? { ...host, subagentIds: [...(host.subagentIds ?? []), id] } : i));
  }
  return { ...s, items, subagents: { ...s.subagents, [id]: n } };
}

/** Local end of a turn: indicators off, streaming items settled. */
const endTurn = (s: ChatState): ChatState => ({ ...s, running: false, turnStart: null, sentAt: null, status: "", generating: "", items: settle(s.items) });

/** `session.info.running` is the gateway's own word on whether a turn runs. `running:false` right after a local send
 *  (before message.start) is the gateway not having started it yet, so it is ignored for 3 s. */
export const OPTIMISTIC_MS = 3000;
function applyRunning(s: ChatState, running: boolean, at?: number): ChatState {
  if (running) return s.running ? s : { ...s, running: true, turnStart: s.turnStart ?? at ?? null, cleared: false };
  if (!s.running) return s;
  if (s.sentAt != null && at != null && at - s.sentAt < OPTIMISTIC_MS) return s;
  return endTurn(s);
}

/** At most one streaming item, and only the last: any item appended after a streaming text or thought settles it. Same array when nothing streams. */
const streams = (i: ChatItem) => (i.kind === "assistant" || i.kind === "thought") && i.streaming;
const settle = (items: ChatItem[]): ChatItem[] =>
  items.some(streams) ? items.map((i) => (streams(i) ? { ...i, streaming: false } : i)) : items;
/** Does the current turn (items after the last user message) already have a thought? */
function turnHasThought(items: ChatItem[]): boolean {
  for (let i = items.length - 1; i >= 0 && items[i].kind !== "user"; i--) if (items[i].kind === "thought") return true;
  return false;
}
const turnHasThoughtText = (items: ChatItem[], t: string) => {
  for (let i = items.length - 1; i >= 0 && items[i].kind !== "user"; i--) { const x = items[i]; if (x.kind === "thought" && x.text.trim() === t.trim()) return true; }
  return false;
};

function onEvent(s: ChatState, ev: GatewayEvent, at?: number): ChatState {
  const p = ev.payload ?? {};
  const last = s.items[s.items.length - 1];
  const live = last?.kind === "assistant" && last.streaming ? last : null;
  switch (ev.type) {
    case "message.start": return { ...s, running: true };
    case "message.delta": {
      if (typeof p.text !== "string" || p.text === "") return s;
      if (s.cleared) s = { ...s, running: true, cleared: false };
      if (live) return { ...s, items: [...s.items.slice(0, -1), { ...live, text: live.text + p.text }] };
      return { ...s, items: [...settle(s.items), { kind: "assistant", id: `m${s.items.length}`, text: p.text, streaming: true }] };
    }
    case "message.complete": {
      const text = typeof p.text === "string" ? p.text : null;
      const reasoning = str(p.reasoning);
      let items = live ? [...s.items.slice(0, -1), { ...live, text: text ?? live.text, streaming: false }] : settle(s.items);
      if (!live && text) items = [...items, { kind: "assistant", id: `m${s.items.length}`, text, streaming: false }];
      // reasoning that was never streamed goes in front of the final answer
      if (reasoning.trim() && !turnHasThought(s.items)) {
        const at = live || text ? items.length - 1 : items.length;
        items = [...items.slice(0, at), { kind: "thought", id: `r${s.items.length}`, text: reasoning, streaming: false }, ...items.slice(at)];
      }
      return { ...s, running: false, status: "", generating: "", items };
    }
    case "reasoning.delta": {
      if (typeof p.text !== "string" || p.text === "") return s;
      if (last?.kind === "thought" && last.streaming)
        return { ...s, items: [...s.items.slice(0, -1), { ...last, text: last.text + p.text, ...(last.startedAt != null && at != null ? { durationS: Math.round((at - last.startedAt) / 1000) } : {}) }] };
      return { ...s, items: [...settle(s.items), { kind: "thought", id: `r${s.items.length}`, text: p.text, streaming: true, ...(at != null ? { startedAt: at, durationS: 0 } : {}) }] };
    }
    case "reasoning.available": {
      if (typeof p.text !== "string" || !p.text.trim() || turnHasThoughtText(s.items, p.text)) return s;
      return { ...s, items: [...settle(s.items), { kind: "thought", id: `r${s.items.length}`, text: p.text, streaming: false }] };
    }
    case "thinking.delta": return { ...s, status: str(p.text) };
    case "tool.generating": return { ...s, generating: str(p.name) };
    case "tool.progress": {
      const progress = typeof p.percent === "number" ? `${Math.round(p.percent)}%` : str(p.message);
      return s.items.some((i) => i.kind === "tool" && i.id === str(p.tool_id)) ? { ...s, items: s.items.map((i) => (i.kind === "tool" && i.id === str(p.tool_id) ? { ...i, progress } : i)) } : s;
    }
    case "tool.start": return { ...s, running: s.cleared ? true : s.running, cleared: false, generating: "", items: [...settle(s.items), { kind: "tool", id: str(p.tool_id) || `t${s.items.length}`, name: str(p.name), context: str(p.context), status: "running", ...toolExtra(p) }] };
    case "tool.complete": {
      const id = str(p.tool_id);
      const patch = { status: (p.is_error ? "error" : "done") as "error" | "done", durationS: typeof p.duration_s === "number" ? p.duration_s : undefined, result: typeof p.result === "string" ? p.result : isObj(p.result) ? JSON.stringify(p.result) : undefined, progress: undefined, ...toolExtra(p) };
      if (s.items.some((i) => i.kind === "tool" && i.id === id)) return { ...s, items: s.items.map((i) => (i.kind === "tool" && i.id === id ? { ...i, ...patch } : i)) };
      return { ...s, items: [...settle(s.items), { kind: "tool", id: id || `t${s.items.length}`, name: str(p.name), context: str(p.context), ...patch }] };
    }
    case "session.info": {
      const model = str(p.model), effort = str(p.reasoning_effort);
      const n = model || effort ? { ...s, model: model || s.model, effort: effort || s.effort } : s;
      return typeof p.running === "boolean" ? applyRunning(n, p.running, at) : n;
    }
    // keeps later session.mutate calls from going stale
    case "session.updated": return { ...s, revision: typeof p.revision === "number" ? p.revision : s.revision, executionGeneration: typeof p.execution_generation === "number" ? p.execution_generation : s.executionGeneration };
    case "session.usage": return typeof p.usage?.model === "string" && p.usage.model ? { ...s, model: p.usage.model } : s;
    case "approval.request": return addPrompt(s, toPrompt(p, "approval"));
    case "clarify.request": return addPrompt(s, toPrompt(p, "clarify"));
    case "approval.settled":
    case "clarify.settled": return dropPrompt(s, str(p.prompt_id));
    case "error": return { ...s, running: false, status: "", generating: "", items: [...settle(s.items), { kind: "error", id: `e${s.items.length}`, text: str(p.message) || str(p.text) || "오류가 발생했습니다" }] };
    default: return s;
  }
}

export type ToolItem = Extract<ChatItem, { kind: "tool" }>;
export type ToolGroup = { kind: "tools"; id: string; items: ToolItem[] };
/** Runs of 2+ consecutive tool items become one group (id = first tool's id, stable while it grows). */
export function groupItems(items: ChatItem[]): (ChatItem | ToolGroup)[] {
  const out: (ChatItem | ToolGroup)[] = [];
  let run: ToolItem[] = [];
  const flush = () => { if (run.length > 1) out.push({ kind: "tools", id: run[0].id, items: run }); else out.push(...run); run = []; };
  // delegate_task stays outside a group so its children are always visible
  for (const i of items) { if (i.kind === "tool" && i.name !== "delegate_task") run.push(i); else { flush(); out.push(i); } }
  flush();
  return out;
}

/** Text of the live status row: prompt, running tool (+ progress), tool being drafted, Hermes status text, thought, answer. */
export function activityLabel(s: Pick<ChatState, "items" | "prompts" | "status" | "generating">): string {
  if (s.prompts.length) return "응답 대기 중";
  const tool = [...s.items].reverse().find((i): i is ToolItem => i.kind === "tool" && i.status === "running");
  if (tool) return [tool.name, tool.context, tool.progress].filter(Boolean).join(" · ");
  if (s.generating) return `${s.generating} 준비 중`;
  if (s.status) return s.status;
  const last = s.items[s.items.length - 1];
  if (last?.kind === "thought" && last.streaming) return "생각 중";
  return last?.kind === "assistant" && last.streaming ? "답변 작성 중" : "생각 중";
}

/** 7초, 1분 12초 */
export const fmtSec = (sec: number) => (sec >= 60 ? `${Math.floor(sec / 60)}분 ${sec % 60}초` : `${sec}초`);

const closedMsg = "연결이 끊어졌습니다";

/** One automatic reconnect per successful connection, and only once a session exists to resume. */
export const shouldAutoReconnect = (sessionId: string | null, attemptsUsed: number) => !!sessionId && attemptsUsed < 1;
/** Current counters from a stale_revision / stale_generation RPC error, or null when a retry makes no sense. */
export function staleRetry(err: unknown): { revision: number; executionGeneration: number } | null {
  const e = err as { message?: string; data?: { revision?: unknown; execution_generation?: unknown } } | null;
  if (!e || !/^(stale_revision|stale_generation|revision_conflict)$/.test(String(e.message))) return null;
  const { revision, execution_generation: gen } = e.data ?? {};
  return typeof revision === "number" && typeof gen === "number" ? { revision, executionGeneration: gen } : null;
}
export interface ModelProvider { provider: string; providerName: string; models: string[] }
interface ModelOptions { model?: string; provider?: string; providers?: { slug: string; name?: string; models?: string[]; authenticated?: boolean; is_current?: boolean }[] }
/** model.options rows -> picker groups. Unauthenticated providers stay (in-house models), and the session's current model is added when no row lists it. */
export function toModelProviders(r: ModelOptions): ModelProvider[] {
  const rows = r.providers ?? [];
  const cur = str(r.model);
  const home = cur && !rows.some((p) => p.models?.includes(cur)) ? (rows.find((p) => p.slug === r.provider) ?? rows.find((p) => p.is_current)) : undefined;
  const out = rows
    .map((p) => ({ provider: p.slug, providerName: (p.name || p.slug) + (p.authenticated === false ? " (인증 안 됨)" : ""), models: [...(p.models ?? []), ...(p === home ? [cur] : [])] }))
    .filter((p) => p.models.length > 0);
  return cur && !home && !out.some((p) => p.models.includes(cur)) ? [{ provider: str(r.provider), providerName: "현재 모델", models: [cur] }, ...out] : out;
}

/** What to do with a slash.exec / command.dispatch result (parseCommandDispatch in hermes shared slash.ts). */
export type SlashDirective =
  | { type: "output"; text: string }
  | { type: "alias"; target: string }
  | { type: "send" | "prefill"; message: string; notice?: string };
export function toDirective(raw: any): SlashDirective | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const notice = str(raw.notice).trim() || undefined;
  switch (raw.type) {
    case undefined: case "exec": case "plugin": {
      const out = str(raw.output) || "(출력 없음)";
      return { type: "output", text: str(raw.warning) ? `warning: ${raw.warning}\n${out}` : out };
    }
    case "alias": return str(raw.target) ? { type: "alias", target: raw.target } : null;
    case "prefill": return typeof raw.message === "string" ? { type: "prefill", message: raw.message, notice } : null;
    case "send": case "skill": return typeof raw.message === "string" ? { type: "send", message: raw.message, notice } : null;
    default: return null;
  }
}
/** prompt.submit answers with a receipt {admission_id, ref, sequence, status: "queued" | "started" | ..., outcome}; anything else means the prompt was not taken. */
export function submitFailure(receipt: unknown): string | null {
  const r = receipt as { status?: unknown; outcome?: unknown } | null;
  if (!r || typeof r !== "object" || typeof r.status !== "string" || ["accepted", "queued", "started"].includes(r.status)) return null;
  return `메시지가 접수되지 않았습니다 (${r.status}${typeof r.outcome === "string" ? `: ${r.outcome}` : ""})`;
}
export const WATCHDOG_MS = 45_000;
/** Running, connected, and neither a gateway frame nor a resync for 45 s. */
export const watchdogDue = (now: number, lastFrame: number, lastResync: number, running: boolean, conn: ChatState["conn"]) =>
  running && conn === "ready" && now - lastFrame >= WATCHDOG_MS && now - lastResync >= WATCHDOG_MS;
export const STUCK_MSG = "Hermes가 이 턴을 아직 끝내지 않았습니다. 다시 Stop을 누르면 Perch의 표시만 정리합니다.";

/** Nothing is delivered while the socket is down, so no user bubble either. */
export const canSend = (s: ChatState) => s.conn === "ready" && !!s.sessionId;

export function useChatSession(paneId: string, cwd: string, resumeId: string | null) {
  const [state, dispatch] = useReducer(chatReducer, initialChat);
  const [nonce, setNonce] = useState(0);
  const rpcRef = useRef<Rpc | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const resumeRef = useRef(resumeId); // first value only; the pane gaining a session id later must not reconnect
  const chain = useRef<Promise<unknown>>(Promise.resolve()); // serializes runs so StrictMode's double effect leaves one connection
  const autoUsed = useRef(0); // automatic reconnects since the last successful connection (max 1)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [retrying, setRetrying] = useState(false);
  const lastFrame = useRef(Date.now()); // time of the last gateway frame (a ref: no render per frame)
  const lastResync = useRef(0);
  const stuck = useRef(false); // Stop did not end the turn and Hermes still says it runs
  const [draft, setDraft] = useState({ text: "", n: 0 }); // /undo-style prefill; the composer applies it when n changes

  useEffect(() => {
    let dead = false;
    let abort = () => {};
    const rpc = createRpc((line) => chatSend(paneId, line));
    const offs: (() => void)[] = [];
    const prev = chain.current;
    chain.current = (async () => {
      await prev.catch(() => {});
      if (dead) return;
      rpcRef.current = rpc;
      setRetrying(false);
      dispatch({ t: "conn", conn: "connecting" });
      try {
        offs.push(rpc.onEvent((ev) => {
          if (dead) return;
          lastFrame.current = Date.now();
          dispatch({ t: "event", ev, at: lastFrame.current });
          if (ev.type === "session.replay_gap" && stateRef.current.sessionId) // events were lost: re-read the whole session
            rpc.request<SessionSnapshot>("session.resume", { session_id: stateRef.current.sessionId }).then((snap) => { if (!dead) dispatch({ t: "snapshot", snap, at: Date.now() }); }, console.error);
        }));
        offs.push(rpc.onClosed((reason) => {
          if (dead) return;
          dispatch({ t: "conn", conn: "closed", error: reason || closedMsg });
          if (!shouldAutoReconnect(stateRef.current.sessionId, autoUsed.current)) return;
          autoUsed.current++;
          setRetrying(true);
          timer.current = setTimeout(() => setNonce((n) => n + 1), 1000);
        }));
        const ready = new Promise<void>((res, rej) => {
          abort = () => rej(new Error("aborted"));
          offs.push(rpc.onClosed((r) => rej(new Error(r || closedMsg))));
          offs.push(rpc.onEvent((ev) => { if (ev.type === "gateway.ready") res(); }));
        });
        ready.catch(() => {});
        await chatConnect(paneId, (line) => rpc.handleLine(line));
        await ready;
        const rid = stateRef.current.sessionId ?? resumeRef.current;
        const snap = await (rid
          ? rpc.request<SessionSnapshot>("session.resume", { session_id: rid })
          : rpc.request<SessionSnapshot>("session.create", { request_id: crypto.randomUUID(), source: "tui", cwd }));
        if (dead) return;
        dispatch({ t: "snapshot", snap, at: Date.now() });
        if (!snap.info?.reasoning_effort) // the snapshot may not carry it; failure just leaves the label generic
          rpc.request<{ value?: string }>("config.get", { key: "reasoning", session_id: snap.session_id }).then((r) => { if (!dead && r?.value) dispatch({ t: "effort", effort: r.value }); }, () => {});
        autoUsed.current = 0; // connected: re-arm
        const stored = snap.stored_session_id ?? snap.session_id;
        resumeRef.current = stored;
        paneSetSession(paneId, stored).catch(console.error);
      } catch (e) {
        if (!dead) dispatch({ t: "conn", conn: "error", error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => { dead = true; clearTimeout(timer.current); abort(); offs.forEach((o) => o()); chatClose(paneId).catch(() => {}); };
  }, [paneId, cwd, nonce]);

  /** Asks the gateway whether the turn still runs. Only a finished turn is adopted (history is authoritative then, which
   *  also drops local system lines); a running turn keeps its live rows. Returns the gateway's `running`, null if unknown. */
  const resync = useCallback(async (): Promise<boolean | null> => {
    const rpc = rpcRef.current, rid = stateRef.current.sessionId ?? resumeRef.current;
    if (!rpc || !rid) return null;
    lastResync.current = Date.now();
    try {
      const snap = await rpc.request<SessionSnapshot>("session.resume", { session_id: rid });
      if (snap.running) return true;
      dispatch({ t: "snapshot", snap, at: Date.now() });
      sessionForceIdle(resumeRef.current ?? rid, 0).catch(console.error); // sidebar and pane header follow the chat row
      return false;
    } catch (e) { console.error(e); return null; }
  }, []);

  useEffect(() => {
    if (!state.running) { stuck.current = false; return; }
    const t = setInterval(() => { if (watchdogDue(Date.now(), lastFrame.current, lastResync.current, stateRef.current.running, stateRef.current.conn)) void resync(); }, 5000);
    return () => clearInterval(t);
  }, [state.running, resync]);

  const call = useCallback((method: string, params: object) => {
    rpcRef.current?.request(method, params).catch((e) => dispatch({ t: "event", ev: { type: "error", payload: { message: e instanceof Error ? e.message : String(e) } } }));
  }, []);
  const base = () => ({ session_id: stateRef.current.sessionId, execution_generation: stateRef.current.executionGeneration });
  // The prompt carries its own generation. Success or any error (already_resolved) means it is gone either way.
  const respond = (method: string, promptId: string, field: object) => {
    const pr = stateRef.current.prompts.find((x) => x.promptId === promptId);
    if (!pr || !rpcRef.current) return;
    const done = () => dispatch({ t: "promptDone", promptId });
    rpcRef.current.request(method, { session_id: stateRef.current.sessionId, execution_generation: pr.executionGeneration, prompt_id: promptId, ...field }).then(done, done);
  };

  const submit = (sid: string, text: string, attachments?: { path: string; mime: string }[]) =>
    rpcRef.current?.request("prompt.submit", { session_id: sid, text, submission_id: crypto.randomUUID(), ...(attachments?.length ? { attachments } : {}) }).then(
      (r) => { const f = submitFailure(r); if (f) dispatch({ t: "event", ev: { type: "error", payload: { message: f } } }); },
      (e) => dispatch({ t: "event", ev: { type: "error", payload: { message: e instanceof Error ? e.message : String(e) } } }));
  const say = (text: string) => dispatch({ t: "system", text });
  // slash.exec first; command.dispatch handles skill/send/alias names it does not know. An alias is followed once.
  async function runSlash(sid: string, text: string, aliased = false): Promise<void> {
    const rpc = rpcRef.current;
    if (!rpc) return;
    const { name, arg } = parseSlash(text);
    if (!name) return say("명령 이름이 없습니다");
    if (name === "model") { // the gateway has no slash.exec for it; this also reaches models that model.options does not list
      const pick = parseModelArg(arg);
      if (!pick) return say("모델 버튼에서 고르거나 /model <이름> [--provider <slug>] 로 지정하세요");
      return changeModel(pick.provider, pick.model).then(() => say("모델을 바꿨습니다: " + pick.model), (e) => { const m = e instanceof Error ? e.message : String(e); say(m === "model_resolution_failed" ? `모델을 찾지 못했습니다: ${pick.model}. provider를 지정해 보세요 (예: /model ${pick.model} --provider custom)` : "모델을 바꾸지 못했습니다: " + m); });
    }
    if (name === "background" || name === "bg") { // the gateway rejects it via slash.exec; it has its own method
      const task = arg.trim();
      if (!task) return say("/background <작업> 형식으로 입력하세요");
      const r = await rpc.request<{ task_id?: string }>("prompt.background", { session_id: sid, text: task });
      return r?.task_id ? dispatch({ t: "background", taskId: r.task_id, text: task, at: Date.now() }) : say("백그라운드 작업을 시작하지 못했습니다");
    }
    if (BLOCKED_SLASH.has(name)) return say(`이 명령은 채팅 보기에서 지원하지 않습니다. TUI 칸을 쓰세요: /${name}`);
    let raw: unknown;
    try { raw = await rpc.request("slash.exec", { session_id: sid, command: text.replace(/^\/+/, "").trim() }); }
    catch (execErr) {
      try { raw = await rpc.request("command.dispatch", { session_id: sid, name, arg }); }
      catch (e2) {
        const m = (x: unknown) => (x instanceof Error ? x.message : String(x));
        // the fallback's "not a quick/plugin/skill command" is routing noise when slash.exec failed for a real reason
        const real = /not a quick\/plugin\/(?:bundle\/)?skill command/i.test(m(e2)) ? execErr : e2;
        return say(m(real) === "unsupported_command" ? `알 수 없는 명령입니다: /${name}` : `/${name} 실패: ${m(real)}`);
      }
    }
    const d = toDirective(raw);
    if (!d) return say(`/${name}: 응답을 해석하지 못했습니다`);
    if (d.type === "output") return say(d.text);
    if (d.type === "alias") return aliased ? say(`/${name}: 별칭이 순환합니다`) : runSlash(sid, `/${d.target} ${arg}`, true);
    if (d.notice) say(d.notice);
    if (!d.message.trim()) return;
    if (d.type === "prefill") setDraft((x) => ({ text: d.message, n: x.n + 1 }));
    else submit(sid, d.message); // the typed command is already the user bubble; the expanded message is model-facing
  }
  // The gateway stays authoritative for the mutation; success carries the new counters.
  async function mutate(operation: string, payload: object) {
    const rpc = rpcRef.current, sid = stateRef.current.sessionId;
    if (!rpc || !sid) throw new Error("연결되지 않았습니다");
    type Res = { revision: number; execution_generation: number; model?: string; effort?: string };
    const run = (revision: number, gen: number) => rpc.request<Res>("session.mutate", {
      session_id: sid, request_id: crypto.randomUUID(), expected_revision: revision, expected_generation: gen, operation, payload,
    });
    try { return await run(stateRef.current.revision, stateRef.current.executionGeneration); }
    catch (e) {
      const retry = staleRetry(e);
      if (!retry) throw e;
      return await run(retry.revision, retry.executionGeneration);
    }
  }

  async function changeModel(provider: string, model: string): Promise<void> {
    const r = await mutate("model", { model, ...(provider && provider !== "auto" ? { provider } : {}) });
    dispatch({ t: "modelChanged", revision: r.revision, executionGeneration: r.execution_generation, model: r.model || model });
  }

  return {
    state,
    retrying,
    draft,
    send(text: string, attachments?: { path: string; mime: string }[]) {
      const sid = stateRef.current.sessionId;
      if (!sid || !canSend(stateRef.current)) return;
      const slash = !attachments?.length && isSlashCommand(text);
      dispatch({ t: "userSent", id: `u${stateRef.current.items.length}`, text, images: attachments?.map((a) => a.path), ...(slash ? {} : { at: Date.now() }) });
      if (slash) runSlash(sid, text).catch((e) => say(e instanceof Error ? e.message : String(e)));
      else submit(sid, text, attachments);
    },
    async completeSlash(text: string): Promise<{ items: { text: string; display?: string; meta?: string; kind?: string | null }[]; replaceFrom: number }> {
      const rpc = rpcRef.current, sid = stateRef.current.sessionId;
      if (!rpc || !sid) return { items: [], replaceFrom: 1 };
      try {
        const r = await rpc.request<{ items?: any[]; replace_from?: number }>("complete.slash", { text, session_id: sid });
        return { items: (r.items ?? []).filter((i) => i && typeof i.text === "string"), replaceFrom: typeof r.replace_from === "number" ? r.replace_from : 1 };
      } catch { return { items: [], replaceFrom: 1 }; }
    },
    stop() {
      if (stuck.current) { // second press: Hermes would not end the turn, clear Perch's own indicators
        stuck.current = false;
        dispatch({ t: "clear" });
        sessionForceIdle(resumeRef.current ?? stateRef.current.sessionId ?? "", 0).catch(console.error);
        return;
      }
      call("session.interrupt", base());
      setTimeout(async () => { // a terminal frame (message.complete / session.info running:false) clears `running` by itself
        if (!stateRef.current.running) return;
        if ((await resync()) === true && stateRef.current.running && !stuck.current) {
          stuck.current = true;
          say(STUCK_MSG);
        }
      }, 3000);
    },
    answerApproval(promptId: string, choice: string) { respond("approval.respond", promptId, { choice }); },
    answerClarify(promptId: string, answer: string) { respond("clarify.respond", promptId, { answer }); },
    async attachImage(bytes: Uint8Array, mime: string): Promise<{ path: string; mime: string }> {
      const rpc = rpcRef.current, sid = stateRef.current.sessionId;
      if (!rpc || !sid) throw new Error("연결되지 않았습니다");
      const ext = imageExt(mime);
      if (!ext) throw new Error("지원하지 않는 이미지 형식입니다");
      if (bytes.length > 20 * 1024 * 1024) throw new Error("이미지가 너무 큽니다 (20MB 제한)");
      const r = await rpc.request<{ path: string; mime: string }>("image.attach_bytes", { session_id: sid, filename: `${crypto.randomUUID()}.${ext}`, content_base64: toBase64(bytes) });
      return { path: r.path, mime: r.mime };
    },
    async listModels(): Promise<ModelProvider[]> {
      const rpc = rpcRef.current, sid = stateRef.current.sessionId;
      if (!rpc || !sid) throw new Error("연결되지 않았습니다");
      return toModelProviders(await rpc.request<ModelOptions>("model.options", { session_id: sid }));
    },
    setModel: changeModel,
    async setEffort(effort: string): Promise<void> {
      const r = await mutate("reasoning", { effort });
      dispatch({ t: "effortChanged", revision: r.revision, executionGeneration: r.execution_generation, effort: r.effort || effort });
    },
    reconnect() { setNonce((n) => n + 1); },
  };
}
