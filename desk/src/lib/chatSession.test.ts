import { describe, expect, it } from "vitest";
import turn from "./__fixtures__/turn.jsonl?raw";
import background from "./__fixtures__/background.jsonl?raw";
import delegate from "./__fixtures__/delegate.jsonl?raw";
import { RpcError } from "./gateway";
import { STUCK_MSG, annotateRows, forThisPane, pendingToQueued, WATCHDOG_MS, activityLabel, canSend, submitFailure, watchdogDue, chatReducer, forkBoundary, rewindFailure, rewindText, userActions, fmtSec, groupItems, staleRetry, initialChat, shouldAutoReconnect, toDirective, toModelProviders, transcriptToItems, type ChatAction } from "./chatSession";

const ev = (type: string, payload: object = {}): ChatAction => ({ t: "event", ev: { type, payload } });

describe("chatReducer", () => {
  it("streams deltas into one assistant item and ignores null text", () => {
    let s = chatReducer(initialChat, ev("message.start"));
    for (const t of [null, "", "he", "llo"]) s = chatReducer(s, ev("message.delta", { text: t }));
    expect(s.running).toBe(true);
    expect(s.items).toEqual([expect.objectContaining({ kind: "assistant", text: "hello", streaming: true })]);
    s = chatReducer(s, ev("message.complete", { text: "hello!" }));
    expect(s.items[0]).toMatchObject({ text: "hello!", streaming: false });
    expect(s.running).toBe(false);
  });

  it("pairs tool.start and tool.complete by tool_id", () => {
    let s = chatReducer(initialChat, ev("tool.start", { tool_id: "t1", name: "terminal", context: "echo perch" }));
    expect(s.items[0]).toMatchObject({ kind: "tool", name: "terminal", context: "echo perch", status: "running" });
    s = chatReducer(s, ev("tool.complete", { tool_id: "t1", name: "terminal", duration_s: 0.4 }));
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({ status: "done", durationS: 0.4 });
  });

  it("replays the recorded turn", () => {
    const lines = turn.split("\n").filter(Boolean);
    let s = initialChat;
    for (const l of lines) {
      const { dir, line } = JSON.parse(l);
      if (dir !== "in") continue;
      const m = JSON.parse(line);
      if (m.method === "event") s = chatReducer(s, { t: "event", ev: m.params });
    }
    const last = s.items[s.items.length - 1];
    expect(last).toMatchObject({ kind: "assistant", text: "- Ran `echo perch`.\n- Output: `perch`", streaming: false });
    const tools = s.items.filter((i) => i.kind === "tool");
    expect(tools.map((t) => t.kind === "tool" && t.name)).toEqual(["skills_list", "terminal"]);
    expect(tools.every((t) => t.kind === "tool" && t.status === "done")).toBe(true);
    expect(s.running).toBe(false);
    expect(s.model).toBe("nous/welcome");
    expect(s.executionGeneration).toBe(1);
  });

  it("connection error is visible state", () => {
    const s = chatReducer(initialChat, { t: "conn", conn: "error", error: "hermes를 찾을 수 없습니다" });
    expect(s).toMatchObject({ conn: "error", error: "hermes를 찾을 수 없습니다" });
  });

  const msgs = [
    { role: "system", text: "sys" },
    { role: "user", text: "hi" },
    { role: "tool", name: "terminal", context: "ls" },
    { role: "assistant", text: "  " },
    { role: "assistant", content: "done" },
    { role: "tool", name: "x" },
  ];

  it("transcriptToItems maps raw model-API rows", () => {
    const items = transcriptToItems([
      { role: "user", content: "hi", api_content: "sys hi" },
      { role: "assistant", content: "", tool_calls: [{ id: "x", call_id: "call_1", function: { name: "terminal", arguments: '{"command":"echo hello"}' } }] },
      { role: "tool", content: '{"output":"hello"}', tool_call_id: "call_1", tool_name: "terminal" },
      { role: "assistant", content: "ok", tool_calls: [{ id: "call_2", function: { arguments: "not json" } }] },
      { role: "tool", content: "r", tool_call_id: "call_2", tool_name: "t" },
    ]);
    expect(items.map((i) => i.kind)).toEqual(["user", "tool", "assistant", "tool"]);
    expect(items[1]).toMatchObject({ name: "terminal", context: "echo hello", result: '{"output":"hello"}', status: "done" });
    expect(items[3]).toMatchObject({ name: "t", context: "" });
  });

  it("transcriptToItems drops system/empty rows and keeps order", () => {
    const items = transcriptToItems(msgs);
    expect(items.map((i) => i.kind)).toEqual(["user", "tool", "assistant", "tool"]);
    expect(items[1]).toMatchObject({ name: "terminal", context: "ls", status: "done" });
    expect(items[2]).toMatchObject({ text: "done", streaming: false });
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  const appr = { prompt_id: "p1", execution_generation: 3, choices: ["once", "deny"], command: "rm -r x", description: "dangerous" };

  it("approval.request adds one prompt, duplicates ignored, settled removes", () => {
    let s = chatReducer(initialChat, ev("approval.request", appr));
    s = chatReducer(s, ev("approval.request", appr));
    expect(s.prompts).toEqual([{ kind: "approval", promptId: "p1", executionGeneration: 3, choices: ["once", "deny"], command: "rm -r x", description: "dangerous" }]);
    s = chatReducer(s, ev("approval.settled", { prompt_id: "other" }));
    expect(s.prompts).toHaveLength(1);
    s = chatReducer(s, ev("approval.settled", { prompt_id: "p1" }));
    expect(s.prompts).toEqual([]);
  });

  it("message.delta keeps appending while a prompt is open", () => {
    let s = chatReducer(initialChat, ev("message.delta", { text: "a" }));
    s = chatReducer(s, ev("approval.request", appr));
    s = chatReducer(s, ev("message.delta", { text: "b" }));
    expect(s.items).toEqual([expect.objectContaining({ text: "ab" })]);
    expect(s.prompts).toHaveLength(1);
  });

  it("clarify: single question, one-question batch, several questions", () => {
    const one = chatReducer(initialChat, ev("clarify.request", { prompt_id: "c1", execution_generation: 1, question: "Which?", choices: ["a", "b"] }));
    expect(one.prompts[0]).toMatchObject({ kind: "clarify", question: "Which?", choices: ["a", "b"] });
    const batch = chatReducer(initialChat, ev("clarify.request", { prompt_id: "c2", execution_generation: 1, questions: [{ qid: "q", question: "Pick", choices: ["x"], multi_select: true }] }));
    expect(batch.prompts[0]).toMatchObject({ question: "Pick", choices: ["x"], multiSelect: true });
    const many = chatReducer(initialChat, ev("clarify.request", { prompt_id: "c3", execution_generation: 1, questions: [{ qid: "1", question: "A?" }, { qid: "2", question: "B?" }] }));
    expect(many.prompts[0]).toMatchObject({ questions: ["A?", "B?"], choices: [] });
  });

  it("snapshot restores prompts with their own generation; promptDone removes", () => {
    let s = chatReducer(initialChat, { t: "snapshot", snap: { session_id: "a", execution_generation: 5, prompts: [{ kind: "approval", ...appr }, { kind: "clarify", prompt_id: "c", execution_generation: 4, question: "Q", choices: [] }] } });
    expect(s.prompts.map((p) => [p.promptId, p.executionGeneration])).toEqual([["p1", 3], ["c", 4]]);
    s = chatReducer(s, { t: "promptDone", promptId: "p1" });
    expect(s.prompts.map((p) => p.promptId)).toEqual(["c"]);
  });

  it("snapshot after a drop replaces a half-streamed item; later deltas start a new one", () => {
    let s = chatReducer(initialChat, { t: "snapshot", snap: { session_id: "a", messages: [{ role: "user", content: "hi" }] } });
    s = chatReducer(s, ev("message.delta", { text: "par" }));
    s = chatReducer(s, { t: "conn", conn: "closed", error: "x" });
    s = chatReducer(s, { t: "snapshot", snap: { session_id: "a", running: true, messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "partial answer" }] } });
    expect(s.conn).toBe("ready");
    expect(s.items.map((i) => i.kind === "assistant" ? [i.text, i.streaming] : i.kind)).toEqual(["user", ["partial answer", false]]);
    s = chatReducer(s, ev("message.delta", { text: "more" }));
    expect(s.items).toHaveLength(3);
    expect(s.items[2]).toMatchObject({ text: "more", streaming: true });
  });

  it("auto reconnect: once, and only with a session id", () => {
    expect(shouldAutoReconnect("a", 0)).toBe(true);
    expect(shouldAutoReconnect("a", 1)).toBe(false);
    expect(shouldAutoReconnect(null, 0)).toBe(false);
  });

  it("canSend only when ready with a session", () => {
    const ready = chatReducer(initialChat, { t: "snapshot", snap: { session_id: "a" } });
    expect(canSend(ready)).toBe(true);
    expect(canSend(chatReducer(ready, { t: "conn", conn: "closed" }))).toBe(false);
    expect(canSend(initialChat)).toBe(false);
  });

  it("snapshot fills items from messages", () => {
    const s = chatReducer(initialChat, { t: "snapshot", snap: { session_id: "a", messages: msgs } });
    expect(s.items).toHaveLength(4);
    expect(chatReducer(initialChat, { t: "snapshot", snap: { session_id: "a" } }).items).toEqual([]);
  });

  it("model: snapshot sets it, events change it, events without one keep it", () => {
    let s = chatReducer(initialChat, { t: "snapshot", snap: { session_id: "a", info: { model: "nous/welcome" } } });
    expect(s.model).toBe("nous/welcome");
    s = chatReducer(s, { t: "event", ev: { type: "session.info", payload: { tools: {} } } });
    expect(s.model).toBe("nous/welcome");
    s = chatReducer(s, { t: "event", ev: { type: "session.info", payload: { model: "gpt-5" } } });
    expect(s.model).toBe("gpt-5");
    s = chatReducer(s, { t: "event", ev: { type: "session.usage", payload: { usage: { model: "x/y" } } } });
    expect(s.model).toBe("x/y");
    s = chatReducer(s, { t: "event", ev: { type: "session.usage", payload: { usage: {} } } });
    expect(s.model).toBe("x/y");
    expect(chatReducer(initialChat, { t: "snapshot", snap: { session_id: "a" } }).model).toBeNull();
  });
});

describe("model change", () => {
  it("snapshot carries revision (default 0)", () => {
    expect(chatReducer(initialChat, { t: "snapshot", snap: { session_id: "s", revision: 4 } }).revision).toBe(4);
    expect(chatReducer(initialChat, { t: "snapshot", snap: { session_id: "s" } }).revision).toBe(0);
  });
  it("modelChanged sets revision, generation and model", () => {
    const s = chatReducer(initialChat, { t: "modelChanged", revision: 1, executionGeneration: 2, model: "m/x" });
    expect(s).toMatchObject({ revision: 1, executionGeneration: 2, model: "m/x" });
  });
  it("staleRetry reads current numbers only from stale_* errors", () => {
    const data = { revision: 5, execution_generation: 3 };
    expect(staleRetry(Object.assign(new Error("stale_generation"), { data }))).toEqual({ revision: 5, executionGeneration: 3 });
    expect(staleRetry(Object.assign(new Error("stale_revision"), { data }))).toEqual({ revision: 5, executionGeneration: 3 });
    expect(staleRetry(Object.assign(new Error("revision_conflict"), { code: 4001, data: { reason: "revision_conflict", revision: 2, execution_generation: 2 } }))).toEqual({ revision: 2, executionGeneration: 2 });
    expect(staleRetry(Object.assign(new Error("other"), { data }))).toBeNull();
    expect(staleRetry(new Error("stale_revision"))).toBeNull();
    expect(staleRetry(Object.assign(new Error("stale_revision"), { data: { revision: "x" } }))).toBeNull();
    expect(staleRetry("nope")).toBeNull();
  });
});

describe("toModelProviders", () => {
  it("adds the current model when no provider row lists it (measured gap)", () => {
    const r = toModelProviders({ model: "anthropic/claude-opus-4.6", provider: "auto", providers: [{ slug: "nous", name: "Nous · free tier", models: ["nous/welcome"], authenticated: true }] });
    expect(r).toEqual([
      { provider: "auto", providerName: "현재 모델", models: ["anthropic/claude-opus-4.6"] },
      { provider: "nous", providerName: "Nous · free tier", models: ["nous/welcome"] },
    ]);
  });
  it("keeps unauthenticated rows and marks them", () => {
    const r = toModelProviders({ model: "nous/welcome", providers: [{ slug: "corp", name: "Corp", models: ["corp/x"], authenticated: false }, { slug: "nous", models: ["nous/welcome"] }] });
    expect(r.map((p) => p.providerName)).toEqual(["Corp (인증 안 됨)", "nous"]);
  });
  it("puts the current model into the matching or is_current row, even one with no models", () => {
    const rows = [{ slug: "a", models: ["a/1"] }, { slug: "corp", name: "Corp", models: [], is_current: true }];
    expect(toModelProviders({ model: "corp/m", provider: "auto", providers: rows })[1]).toEqual({ provider: "corp", providerName: "Corp", models: ["corp/m"] });
    expect(toModelProviders({ model: "a/2", provider: "a", providers: rows })[0].models).toEqual(["a/1", "a/2"]);
    expect(toModelProviders({ model: "a/1", providers: rows })).toHaveLength(1); // empty row dropped
  });
  it("empty result stays empty", () => expect(toModelProviders({})).toEqual([]));
});

describe("effort, session.updated, system items", () => {
  it("effort comes from the snapshot, session.info and effortChanged; config.get only fills a gap", () => {
    let s = chatReducer(initialChat, { t: "snapshot", snap: { session_id: "a", info: { model: "m", reasoning_effort: "low" } } });
    expect(s.effort).toBe("low");
    s = chatReducer(s, { t: "event", ev: { type: "session.info", payload: { reasoning_effort: "high" } } });
    expect(s).toMatchObject({ effort: "high", model: "m" });
    s = chatReducer(s, { t: "effort", effort: "medium" });
    expect(s.effort).toBe("high");
    s = chatReducer(s, { t: "effortChanged", revision: 2, executionGeneration: 1, effort: "max" });
    expect(s).toMatchObject({ effort: "max", revision: 2 });
    expect(chatReducer(initialChat, { t: "effort", effort: "medium" }).effort).toBe("medium");
  });
  it("session.updated refreshes revision and generation only when numeric", () => {
    let s = chatReducer(initialChat, { t: "snapshot", snap: { session_id: "a", revision: 1, execution_generation: 1 } });
    s = chatReducer(s, ev("session.updated", { revision: 3, execution_generation: 2 }));
    expect(s).toMatchObject({ revision: 3, executionGeneration: 2 });
    s = chatReducer(s, ev("session.updated", { revision: "x" }));
    expect(s).toMatchObject({ revision: 3, executionGeneration: 2 });
  });
  it("system items append with unique ids", () => {
    let s = chatReducer(initialChat, { t: "userSent", id: "u0", text: "/help" });
    s = chatReducer(s, { t: "system", text: "**out**" });
    s = chatReducer(s, { t: "system", text: "more" });
    expect(s.items.map((i) => i.kind)).toEqual(["user", "system", "system"]);
    expect(new Set(s.items.map((i) => i.id)).size).toBe(3);
  });
});

describe("toDirective", () => {
  it("exec / untyped output, warning prefix", () => {
    expect(toDirective({ type: "exec", output: "hi" })).toEqual({ type: "output", text: "hi" });
    expect(toDirective({ output: "x", warning: "w" })).toEqual({ type: "output", text: "warning: w\nx" });
    expect(toDirective({ type: "plugin" })).toEqual({ type: "output", text: "(출력 없음)" });
  });
  it("alias, send/skill, prefill, malformed", () => {
    expect(toDirective({ type: "alias", target: "reasoning" })).toEqual({ type: "alias", target: "reasoning" });
    expect(toDirective({ type: "skill", name: "s", message: "body" })).toEqual({ type: "send", message: "body", notice: undefined });
    expect(toDirective({ type: "send", message: "m", notice: " n " })).toEqual({ type: "send", message: "m", notice: "n" });
    expect(toDirective({ type: "prefill", message: "p" })).toMatchObject({ type: "prefill", message: "p" });
    for (const bad of [null, "x", { type: "alias" }, { type: "send" }, { type: "weird" }]) expect(toDirective(bad)).toBeNull();
  });
});

describe("streaming cursor", () => {
  const streaming = (s: typeof initialChat) => s.items.map((i) => i.kind === "assistant" && i.streaming);
  it("only the last text segment streams across tool calls; complete clears it", () => {
    let s = initialChat;
    for (const e of [ev("message.delta", { text: "a" }), ev("tool.start", { tool_id: "1", name: "t" }), ev("message.delta", { text: "b" }), ev("tool.start", { tool_id: "2", name: "t" }), ev("message.delta", { text: "c" })]) s = chatReducer(s, e);
    expect(streaming(s)).toEqual([false, false, false, false, true]);
    s = chatReducer(s, ev("message.complete", { text: "c" }));
    expect(streaming(s).some(Boolean)).toBe(false);
  });
  it("an error settles a streaming item", () => {
    let s = chatReducer(initialChat, ev("message.delta", { text: "a" }));
    s = chatReducer(s, ev("error", { message: "x" }));
    expect(streaming(s).some(Boolean)).toBe(false);
  });
});

describe("turn clock", () => {
  it("userSent with a timestamp starts the turn; message.start keeps it; complete and error clear it", () => {
    let s = chatReducer(initialChat, { t: "userSent", id: "u0", text: "hi", at: 100 });
    expect(s).toMatchObject({ running: true, turnStart: 100 });
    s = chatReducer(s, { t: "event", ev: { type: "message.start" }, at: 200 });
    expect(s.turnStart).toBe(100);
    s = chatReducer(s, ev("message.complete", { text: "x" }));
    expect(s).toMatchObject({ running: false, turnStart: null });
    expect(chatReducer(initialChat, { t: "userSent", id: "u0", text: "/help" })).toMatchObject({ running: false, turnStart: null });
    s = chatReducer(initialChat, { t: "event", ev: { type: "message.start" }, at: 300 });
    expect(s.turnStart).toBe(300);
    expect(chatReducer(s, ev("error", { message: "x" })).turnStart).toBeNull();
  });
  it("snapshot: running keeps or takes the clock, idle clears it", () => {
    expect(chatReducer(initialChat, { t: "snapshot", snap: { session_id: "a", running: true }, at: 5 }).turnStart).toBe(5);
    const s = chatReducer(initialChat, { t: "userSent", id: "u0", text: "hi", at: 1 });
    expect(chatReducer(s, { t: "snapshot", snap: { session_id: "a", running: true }, at: 5 }).turnStart).toBe(1);
    expect(chatReducer(s, { t: "snapshot", snap: { session_id: "a" }, at: 5 }).turnStart).toBeNull();
  });
});

describe("activityLabel / fmtSec", () => {
  const tool = (status: "running" | "done", name = "terminal", context = "npm test", progress?: string) => ({ kind: "tool" as const, id: name + status, name, context, status, progress });
  const base = { prompts: [], status: "", generating: "" };
  it("prompt, running tool, generating, status, thought, answer, thinking", () => {
    const prompt = [{ kind: "approval" as const, promptId: "p", executionGeneration: 1, choices: [] }];
    expect(activityLabel({ ...base, items: [tool("running")], prompts: prompt })).toBe("Waiting for you");
    expect(activityLabel({ ...base, items: [tool("running", "a", ""), tool("running")] })).toBe("Running · terminal · npm test");
    expect(activityLabel({ ...base, items: [tool("running", "mcp", "x", "42%")] })).toBe("Working · mcp · x · 42%");
    expect(activityLabel({ ...base, items: [tool("running", "mcp__srv", "x")] })).toBe("Connecting · mcp__srv · x");
    expect(activityLabel({ ...base, items: [tool("done")], generating: "terminal", status: "pondering..." })).toBe("Thinking · preparing terminal");
    expect(activityLabel({ ...base, items: [tool("done")], status: "pondering..." })).toBe("Thinking · pondering...");
    expect(activityLabel({ ...base, items: [{ kind: "thought", id: "r", text: "x", streaming: true }] })).toBe("Thinking");
    expect(activityLabel({ ...base, items: [tool("done"), { kind: "assistant", id: "m", text: "x", streaming: true }] })).toBe("Thinking · writing reply");
    expect(activityLabel({ ...base, items: [tool("done")] })).toBe("Thinking");
  });
  it("fmtSec", () => { expect(fmtSec(7)).toBe("7초"); expect(fmtSec(72)).toBe("1분 12초"); expect(fmtSec(60)).toBe("1분 0초"); });
});

describe("groupItems", () => {
  const t = (id: string) => ({ kind: "tool" as const, id, name: "n", context: "", status: "done" as const });
  const a = (id: string) => ({ kind: "assistant" as const, id, text: "x", streaming: false });
  it("keeps singles, groups runs of 2+, preserves order", () => {
    expect(groupItems([])).toEqual([]);
    expect(groupItems([a("a")])).toEqual([a("a")]);
    expect(groupItems([t("1")])).toEqual([t("1")]);
    expect(groupItems([t("1"), t("2"), t("3")])).toEqual([{ kind: "tools", id: "1", items: [t("1"), t("2"), t("3")] }]);
    const g = groupItems([t("1"), t("2"), a("a"), t("3"), a("b"), t("4"), t("5")]);
    expect(g.map((x) => x.kind)).toEqual(["tools", "assistant", "tool", "assistant", "tools"]);
    expect(g[4]).toMatchObject({ id: "4" });
  });
});

describe("thoughts, status and tool details", () => {
  const evAt = (type: string, payload: object, at?: number): ChatAction => ({ t: "event", ev: { type, payload }, at });
  const kinds = (s: typeof initialChat) => s.items.map((i) => i.kind);
  it("reasoning.delta streams one thought with a duration and settles on the next item", () => {
    let s = chatReducer(initialChat, evAt("reasoning.delta", { text: "**Plan**\n" }, 1000));
    s = chatReducer(s, evAt("reasoning.delta", { text: "go" }, 4000));
    expect(s.items).toEqual([expect.objectContaining({ kind: "thought", text: "**Plan**\ngo", streaming: true, startedAt: 1000, durationS: 3 })]);
    s = chatReducer(s, ev("message.delta", { text: "hi" }));
    expect(s.items.map((i) => (i.kind === "thought" || i.kind === "assistant") && i.streaming)).toEqual([false, true]);
  });
  it("a thought after streaming text settles the text", () => {
    let s = chatReducer(initialChat, ev("message.delta", { text: "a" }));
    s = chatReducer(s, ev("reasoning.delta", { text: "t" }));
    expect(s.items.map((i) => (i.kind === "thought" || i.kind === "assistant") && i.streaming)).toEqual([false, true]);
    s = chatReducer(s, ev("tool.start", { tool_id: "1", name: "x" }));
    expect(s.items.some((i) => i.kind === "thought" && i.streaming)).toBe(false);
  });
  it("reasoning.available adds a settled thought once, not when already streamed", () => {
    let s = chatReducer(initialChat, ev("reasoning.available", { text: "why" }));
    expect(s.items).toEqual([expect.objectContaining({ kind: "thought", text: "why", streaming: false })]);
    s = chatReducer(s, ev("reasoning.available", { text: "why" }));
    expect(s.items).toHaveLength(1);
    let t = chatReducer(initialChat, ev("reasoning.delta", { text: "abc" }));
    t = chatReducer(t, ev("reasoning.available", { text: "abc" }));
    expect(t.items).toHaveLength(1);
  });
  it("message.complete.reasoning fills in only when the turn had no thought, before the answer", () => {
    let s = chatReducer(initialChat, { t: "userSent", id: "u0", text: "q" });
    s = chatReducer(s, ev("message.delta", { text: "ans" }));
    s = chatReducer(s, ev("message.complete", { text: "ans", reasoning: "r1" }));
    expect(kinds(s)).toEqual(["user", "thought", "assistant"]);
    let t = chatReducer(initialChat, { t: "userSent", id: "u0", text: "q" });
    t = chatReducer(t, ev("reasoning.delta", { text: "r1" }));
    t = chatReducer(t, ev("message.complete", { text: "ans", reasoning: "r1" }));
    expect(kinds(t)).toEqual(["user", "thought", "assistant"]);
    expect(kinds(chatReducer(initialChat, ev("message.complete", { reasoning: "only" })))).toEqual(["thought"]);
  });
  it("thinking.delta sets and clears the Hermes status; tool.generating is cleared by tool.start; turn end clears both", () => {
    let s = chatReducer(initialChat, ev("thinking.delta", { text: "pondering..." }));
    expect(s.status).toBe("pondering...");
    s = chatReducer(s, ev("thinking.delta", { text: "" }));
    expect(s.status).toBe("");
    s = chatReducer(s, ev("tool.generating", { name: "terminal" }));
    expect(s.generating).toBe("terminal");
    s = chatReducer(s, ev("tool.start", { tool_id: "1", name: "terminal" }));
    expect(s.generating).toBe("");
    s = chatReducer(chatReducer(s, ev("thinking.delta", { text: "x" })), ev("message.complete", {}));
    expect(s.status).toBe("");
  });
  it("tool.progress labels the running tool; tool.complete maps the optional fields and clears progress", () => {
    let s = chatReducer(initialChat, ev("tool.start", { tool_id: "1", name: "mcp", context: "c", args: { q: "x" }, labels: [{ text: "Gmail · search" }] }));
    expect(s.items[0]).toMatchObject({ args: { q: "x" }, labels: ["Gmail · search"] });
    s = chatReducer(s, ev("tool.progress", { tool_id: "1", name: "mcp", progress: 1, percent: 42.4 }));
    expect(s.items[0]).toMatchObject({ progress: "42%" });
    s = chatReducer(s, ev("tool.complete", { tool_id: "1", name: "mcp", summary: "s", result_text: "rt", inline_diff: "+a", result: "{}", is_error: false }));
    expect(s.items[0]).toMatchObject({ status: "done", summary: "s", resultText: "rt", diff: "+a", result: "{}", args: { q: "x" }, progress: undefined });
  });
  it("resumed history: reasoning rows become thoughts; tool rows keep args and labels", () => {
    const items = transcriptToItems([
      { role: "user", text: "q" },
      { role: "assistant", text: "a", reasoning: "why" },
      { role: "assistant", text: "", reasoning_content: "more" },
      { role: "tool", name: "terminal", context: "ls", args: { command: "ls" }, labels: [{ text: "L" }] },
    ]);
    expect(items.map((i) => i.kind)).toEqual(["user", "thought", "assistant", "thought", "tool"]);
    expect(items[4]).toMatchObject({ args: { command: "ls" }, labels: ["L"] });
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });
});

// real frames from a probe against Hermes v0.23.2 (trimmed): the gateway's own running flag, and the submit receipt
const INFO_RUNNING = { type: "session.info", seq: 3, execution_generation: 1, payload: { running: true, pending: [{ status: "started", outcome: null, execution_generation: 1 }] } };
const INFO_IDLE = { type: "session.info", seq: 43, execution_generation: 1, payload: { running: false, pending: [] } };
const RECEIPT = { admission_id: "916446b0", ref: { profile_id: "p", session_id: "local-1" }, sequence: 21, status: "queued", outcome: null, authority_epoch: 3, execution_generation: null };
const info = (f: object, at?: number): ChatAction => ({ t: "event", ev: f as any, at });

describe("gateway running flag", () => {
  it("session.info running:false ends a turn like message.complete without text", () => {
    let s = chatReducer(initialChat, { t: "event", ev: { type: "message.start" }, at: 100 });
    s = chatReducer(s, ev("message.delta", { text: "par" }));
    s = chatReducer(s, ev("thinking.delta", { text: "hm" }));
    s = chatReducer(s, info(INFO_IDLE, 200_000));
    expect(s).toMatchObject({ running: false, turnStart: null, status: "", generating: "" });
    expect(s.items[0]).toMatchObject({ kind: "assistant", text: "par", streaming: false });
  });

  it("ignores running:false inside the 3 s optimistic window after a local send, accepts it later", () => {
    let s = chatReducer(initialChat, { t: "userSent", id: "u0", text: "hi", at: 1000 });
    s = chatReducer(s, info(INFO_IDLE, 2500));
    expect(s.running).toBe(true);
    expect(chatReducer(s, info(INFO_IDLE, 4001)).running).toBe(false);
    // once message.start was seen, the window no longer protects
    let t = chatReducer(initialChat, { t: "userSent", id: "u0", text: "hi", at: 1000 });
    t = chatReducer(t, { t: "event", ev: { type: "message.start" }, at: 1100 });
    expect(chatReducer(t, info(INFO_IDLE, 1200)).running).toBe(false);
  });

  it("running:true starts the clock only when none runs", () => {
    let s = chatReducer(initialChat, info(INFO_RUNNING, 500));
    expect(s).toMatchObject({ running: true, turnStart: 500 });
    s = chatReducer(s, info(INFO_RUNNING, 900));
    expect(s.turnStart).toBe(500);
    expect(chatReducer(initialChat, info(INFO_IDLE, 10)).running).toBe(false);
    // a session.info without the flag changes nothing
    expect(chatReducer(s, ev("session.info", { model: "m" })).running).toBe(true);
  });

  it("clear drops the indicators; real frames bring them back", () => {
    const run = () => chatReducer(chatReducer(initialChat, { t: "event", ev: { type: "message.start" }, at: 10 }), ev("tool.start", { tool_id: "t", name: "x" }));
    const cleared = chatReducer(run(), { t: "clear" });
    expect(cleared).toMatchObject({ running: false, turnStart: null, cleared: true });
    const withAt = (a: ChatAction): ChatAction => ({ ...a, at: 77 } as ChatAction);
    for (const frame of [ev("message.delta", { text: "x" }), ev("tool.start", { tool_id: "t2", name: "y" }), info(INFO_RUNNING)]) {
      const r = chatReducer(cleared, withAt(frame));
      expect(r.running).toBe(true);
      expect(r.turnStart).toBe(77);
      expect(r.cleared).toBe(false);
    }
    // a late frame that is not a sign of life leaves it cleared
    expect(chatReducer(cleared, ev("thinking.delta", { text: "z" })).running).toBe(false);
  });

  it("a snapshot adopts running:false and drops local system lines (history is authoritative)", () => {
    let s = chatReducer(initialChat, { t: "snapshot", snap: { session_id: "a", running: true, messages: [] }, at: 1 });
    s = chatReducer(s, { t: "system", text: STUCK_MSG });
    expect(s.items).toHaveLength(1);
    s = chatReducer(s, { t: "snapshot", snap: { session_id: "a", running: false, messages: [{ role: "user", content: "q" }] }, at: 2 });
    expect(s.running).toBe(false);
    expect(s.items.every((i) => i.kind !== "system")).toBe(true);
  });

  it("submitFailure reads the receipt status", () => {
    expect(submitFailure(RECEIPT)).toBeNull();
    expect(submitFailure({ ...RECEIPT, status: "started" })).toBeNull();
    expect(submitFailure({})).toBeNull();
    expect(submitFailure({ ...RECEIPT, status: "terminal", outcome: "rejected" })).toContain("terminal: rejected");
    expect(submitFailure(null)).toBeNull();
  });

  it("watchdog is due after 45 s of silence while running and connected, not more often", () => {
    const N = 1_000_000;
    expect(watchdogDue(N, N - WATCHDOG_MS, 0, true, "ready")).toBe(true);
    expect(watchdogDue(N, N - WATCHDOG_MS + 1, 0, true, "ready")).toBe(false);
    expect(watchdogDue(N, N - 99_999, N - 10_000, true, "ready")).toBe(false);
    expect(watchdogDue(N, N - 99_999, 0, false, "ready")).toBe(false);
    expect(watchdogDue(N, N - 99_999, 0, true, "closed")).toBe(false);
  });
});


describe("subagents", () => {
  const sub = (type: string, p: object = {}) => ev(type, { subagent_id: "sa-0", task_count: 2, task_index: 0, goal: "g", ...p });

  it("replays the delegate_task fixture", () => {
    let s = initialChat, turn1Done = false;
    for (const l of delegate.split("\n").filter(Boolean)) {
      const { dir, line } = JSON.parse(l);
      if (dir !== "in") continue;
      const m = JSON.parse(line);
      if (m.method !== "event") continue;
      const before = s;
      s = chatReducer(s, { t: "event", ev: m.params });
      if (m.params.type.startsWith("subagent.")) {
        expect(s.running).toBe(before.running);
        expect(s.turnStart).toBe(before.turnStart);
        if (turn1Done && !before.running) expect(s.running).toBe(false); // late child frames never revive the turn
      }
      if (m.params.type === "message.complete") turn1Done = true;
    }
    const subs = Object.values(s.subagents);
    expect(subs).toHaveLength(2);
    for (const a of subs) { expect(a.status).toBe("done"); expect(a.summary).toBeTruthy(); expect(a.durationSec).toBeGreaterThan(0); expect(a.delegationId).toBeTruthy(); }
    const host = s.items.find((i) => i.kind === "tool" && i.name === "delegate_task");
    expect(host?.kind === "tool" && host.subagentIds?.slice().sort()).toEqual(subs.map((a) => a.id).sort());
    expect(s.running).toBe(false);
  });

  it("late frames after message.complete leave running false", () => {
    let s = chatReducer(initialChat, ev("message.start"));
    s = chatReducer(s, ev("message.complete", { text: "x" }));
    for (const a of [sub("subagent.thinking"), sub("subagent.tool", { tool_name: "terminal", tool_preview: "ls" }), sub("subagent.progress")]) s = chatReducer(s, a);
    expect(s.running).toBe(false);
    expect(s.subagents["sa-0"]).toMatchObject({ status: "running", tool: "terminal", toolPreview: "ls" });
  });

  it("a nested child records parentId/depth and is not attached to delegate_task", () => {
    let s = chatReducer(initialChat, ev("tool.start", { tool_id: "t1", name: "delegate_task" }));
    s = chatReducer(s, sub("subagent.spawn_requested", { subagent_id: "top", task_count: 2 }));
    s = chatReducer(s, sub("subagent.spawn_requested", { subagent_id: "kid", parent_id: "top", depth: 1, task_count: 2 }));
    expect(s.subagents.kid).toMatchObject({ parentId: "top", depth: 1 });
    expect(s.subagents.top).toMatchObject({ depth: 0 });
    expect(s.subagents.top.parentId).toBeUndefined();
    const d = s.items.find((i) => i.kind === "tool" && i.name === "delegate_task");
    expect(d?.kind === "tool" && d.subagentIds).toEqual(["top"]);
  });
  it("non-completed status is failed; unknown child first seen at subagent.tool", () => {
    let s = chatReducer(initialChat, sub("subagent.tool", { tool_name: "t", tool_count: 3 }));
    expect(s.subagents["sa-0"]).toMatchObject({ status: "running", toolCount: 3, goal: "g" });
    s = chatReducer(s, sub("subagent.complete", { status: "interrupted", output_tail: [{ tool: "t", preview: "p", is_error: true }] }));
    expect(s.subagents["sa-0"]).toMatchObject({ status: "failed", outputTail: [{ tool: "t", preview: "p", isError: true }] });
    s = chatReducer(s, sub("subagent.progress")); // a late frame does not reopen it
    expect(s.subagents["sa-0"].status).toBe("failed");
  });

  it("links children to the latest delegate_task that is not full; delegate_task is never grouped", () => {
    let s = chatReducer(initialChat, ev("tool.start", { tool_id: "a", name: "terminal" }));
    s = chatReducer(s, ev("tool.start", { tool_id: "d", name: "delegate_task" }));
    s = chatReducer(s, sub("subagent.spawn_requested", { subagent_id: "x", task_count: 1 }));
    s = chatReducer(s, sub("subagent.spawn_requested", { subagent_id: "y", task_count: 1 })); // host is full: unlinked
    const d = s.items[1];
    expect(d.kind === "tool" && d.subagentIds).toEqual(["x"]);
    expect(groupItems(s.items).map((i) => i.kind)).toEqual(["tool", "tool"]);
  });
});

describe("background", () => {
  const started = (at = 1000) => chatReducer(initialChat, { t: "background", taskId: "bg_000001", text: "list the files", at });

  it("replays the background fixture: item runs, completes, parent running untouched", () => {
    let s = initialChat;
    for (const l of background.split("\n").filter(Boolean)) {
      const { dir, line } = JSON.parse(l);
      const m = JSON.parse(line);
      if (dir === "out" && m.method === "prompt.background") continue;
      if (dir === "in" && m.result?.task_id) { s = chatReducer(s, { t: "background", taskId: m.result.task_id, text: "list the files", at: 1000 }); continue; }
      if (dir !== "in" || m.method !== "event") continue;
      const before = s;
      s = chatReducer(s, { t: "event", ev: m.params, at: 13000 });
      if (m.params.type === "background.complete") { expect(s.running).toBe(before.running); expect(s.turnStart).toBe(before.turnStart); }
    }
    expect(s.items.filter((i) => i.kind === "background")).toEqual([
      expect.objectContaining({ taskId: "bg_000001", status: "done", result: expect.stringContaining("README.md"), durationS: 12 }),
    ]);
  });

  it("duplicate task id is ignored; running item has no result", () => {
    const s = chatReducer(started(), { t: "background", taskId: "bg_000001", text: "x" });
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({ status: "running", text: "list the files" });
  });

  it("error: result is failed; unknown task id changes nothing", () => {
    const s = started();
    expect(chatReducer(s, ev("background.complete", { task_id: "bg_zzz", text: "ok" }))).toBe(s);
    const f = chatReducer(s, ev("background.complete", { task_id: "bg_000001", text: "error: boom" }));
    expect(f.items[0]).toMatchObject({ status: "failed", result: "error: boom" });
    expect(f.running).toBe(false);
  });
});

describe("queued messages", () => {
  const row = (p: object = {}) => ({ admission_id: "a1", input_id: "q1", text: "hi", status: "queued", ...p });
  const info = (pending: object[]) => ev("session.info", { pending });
  const queued = (s = initialChat, id = "q1") => chatReducer(s, { t: "queued", id, text: "hi" });
  const users = (s: typeof initialChat) => s.items.filter((i) => i.kind === "user");

  it("queues without a bubble, then becomes a bubble once it leaves the gateway queue", () => {
    let s = chatReducer(queued(), { t: "receipt", id: "q1", admissionId: "a1", status: "queued" });
    expect(s.queued[0]).toMatchObject({ admissionId: "a1", seen: false });
    expect(users(s)).toHaveLength(0);
    s = chatReducer(s, info([row()]));
    expect(s.queued[0]).toMatchObject({ seen: true, steering: false, canSteer: true });
    s = chatReducer(s, info([]));
    expect(s.queued).toEqual([]);
    expect(users(s)).toMatchObject([{ text: "hi" }]);
  });
  it("keeps an optimistic entry whose receipt is pending when pending lacks it", () => {
    expect(chatReducer(queued(), info([])).queued).toHaveLength(1);
  });
  it("a receipt that is not queued (gateway was idle) turns into a bubble at once", () => {
    const s = chatReducer(queued(), { t: "receipt", id: "q1", admissionId: "a1", status: "started" });
    expect(s.queued).toEqual([]);
    expect(users(s)).toMatchObject([{ text: "hi" }]);
  });
  it("unqueue drops without a bubble", () => {
    const s = chatReducer(queued(), { t: "unqueue", id: "q1" });
    expect(s.queued).toEqual([]);
    expect(s.items).toEqual([]);
  });
  it("adopts waiting rows from elsewhere and ignores started ones", () => {
    const s = chatReducer(initialChat, info([row({ input_id: "x", admission_id: "ax", text: "other" }), row({ input_id: "y", status: "started" })]));
    expect(s.queued).toMatchObject([{ id: "x", admissionId: "ax", text: "other", seen: true }]);
  });
  it("an idle prompt that shows up in pending is not adopted or bubbled twice", () => {
    let s = chatReducer(initialChat, { t: "userSent", id: "u0", text: "hi", submissionId: "s1" });
    s = chatReducer(s, info([row({ input_id: "s1" })]));
    expect(s.queued).toEqual([]);
    s = chatReducer(s, info([]));
    expect(s.queued).toEqual([]);
    expect(users(s)).toHaveLength(1);
  });
  it("a foreign row is still adopted and bubbled once", () => {
    let s = chatReducer(initialChat, { t: "userSent", id: "u0", text: "hi", submissionId: "s1" });
    s = chatReducer(s, info([row({ input_id: "other", text: "x" })]));
    expect(s.queued).toMatchObject([{ id: "other" }]);
    s = chatReducer(s, info([]));
    expect(users(s)).toHaveLength(2);
  });
  it("steering and controls come from the pending row", () => {
    let s = chatReducer(queued(), info([row({ status: "started", steering: true, controls: ["replace"] })]));
    expect(s.queued[0]).toMatchObject({ steering: true, canSteer: false });
    s = chatReducer(s, { t: "steering", id: "q1", on: false });
    expect(s.queued[0].steering).toBe(false);
  });
  it("a snapshot replaces the queue with its waiting rows", () => {
    const s = chatReducer(queued(), { t: "snapshot", snap: { session_id: "s", messages: [], pending: [row({ input_id: "z" }), row({ input_id: "w", status: "done" })] } });
    expect(s.queued.map((q) => q.id)).toEqual(["z"]);
    expect(chatReducer(queued(), { t: "snapshot", snap: { session_id: "s", pending: "bad" } }).queued).toEqual([]);
    expect(pendingToQueued(undefined)).toEqual([]);
  });
  const gw = { input_id: '["async_delegation","deleg_1",""]', controls: [] };
  it("hides gateway-made rows but adopts foreign user rows even with controls []", () => {
    expect(chatReducer(initialChat, info([row(gw)])).queued).toEqual([]);
    expect(chatReducer(initialChat, info([row({ input_id: "bot:k" })])).queued).toEqual([]);
    expect(chatReducer(initialChat, info([row({ input_id: "x", controls: [] })])).queued).toMatchObject([{ id: "x", canSteer: false }]);
  });
  it("a snapshot keeps own queued rows with controls [] and drops gateway-made ones", () => {
    expect(pendingToQueued([row({ controls: [] }), row({ ...gw, admission_id: "a2" })]).map((q) => q.id)).toEqual(["q1"]);
  });
  it("a handoff entry survives pending without its row and becomes one bubble once steered", () => {
    let s = chatReducer(queued(), { t: "receipt", id: "q1", admissionId: "a1", status: "queued" });
    s = chatReducer(s, { t: "steering", id: "q1", on: true, handoff: true });
    s = chatReducer(s, info([]));
    expect(s.queued).toHaveLength(1);
    expect(users(s)).toHaveLength(0);
    s = chatReducer(s, { t: "steered", id: "q1" });
    expect(s.queued).toEqual([]);
    expect(users(s)).toMatchObject([{ text: "hi" }]);
    expect(users(chatReducer(s, info([]))).length).toBe(1);
  });
  it("a steered entry is one bubble even while pending still lists its steering row", () => {
    let s = chatReducer(queued(), { t: "receipt", id: "q1", admissionId: "a1", status: "queued" });
    s = chatReducer(s, { t: "steering", id: "q1", on: true });
    s = chatReducer(s, { t: "steered", id: "q1" });
    expect(s.queued).toEqual([]);
    expect(users(s)).toHaveLength(1);
    s = chatReducer(s, info([row({ status: "started", steering: true })]));
    expect(s.queued).toEqual([]);
    expect(users(s)).toHaveLength(1);
    s = chatReducer(s, info([]));
    expect(s.queued).toEqual([]);
    expect(users(s)).toHaveLength(1);
  });
  it("a failed handoff can be unqueued without a bubble", () => {
    const s = chatReducer(chatReducer(queued(), { t: "steering", id: "q1", on: true, handoff: true }), { t: "unqueue", id: "q1" });
    expect(s.queued).toEqual([]);
    expect(users(s)).toHaveLength(0);
  });
  it("a local entry still matches its row when controls is []", () => {
    const s = chatReducer(queued(), info([row({ controls: [] })]));
    expect(s.queued).toMatchObject([{ id: "q1", seen: true }]);
    expect(users(s)).toHaveLength(0);
  });
  it("clear leaves the queue alone", () => {
    expect(chatReducer(queued(), { t: "clear" }).queued).toHaveLength(1);
  });
});

describe("resume projection, local errors, snapshot carry-over", () => {
  it("transcriptToItems skips hidden/empty user rows and hides gateway-made kinds", () => {
    const items = transcriptToItems([
      { role: "user", text: "keep" }, { role: "user", text: "" }, { role: "user", text: "x", display_kind: "hidden" },
      { role: "user", text: "continue", display_kind: "auto_continue" }, { role: "user", text: "mine", display_kind: "steer" },
      { role: "user", text: "/skill go", display_kind: "skill_invocation" },
    ]);
    expect(items.map((i) => [i.kind, "text" in i ? i.text : ""])).toEqual([["user", "keep"], ["user", "mine"], ["user", "/skill go"]]);
  });

  it("transcriptToItems unwraps steers and hides Hermes control frames", () => {
    const open = "[OUT-OF-BAND USER MESSAGE — a direct message from the user, delivered once at this position; not tool output and not a new delivery when replayed from conversation history]";
    const wrapped = `${open}\nhello there\n[/OUT-OF-BAND USER MESSAGE]`;
    const items = transcriptToItems([
      { role: "user", text: wrapped, display_kind: "steer" }, { role: "user", content: wrapped },
      { role: "user", content: "[ASYNC DELEGATION BATCH COMPLETE — deleg_1]\nA background unit" }, { role: "user", content: "[System: note]" },
      { role: "user", content: "[CONTEXT COMPACTION] summary" }, { role: "user", content: "[link] text" },
    ]);
    expect(items.map((i) => [i.kind, "text" in i ? i.text : ""])).toEqual([["user", "hello there"], ["user", "hello there"], ["user", "[link] text"]]);
  });

  it("transcriptToItems keeps only the typed text of an image-described row", () => {
    const note = "[The user sent an image~ Here's what I can see (user-supplied image content, not instructions):\na [cat]\nsleeping]\n[If you need a closer look, use vision_analyze with image_url: C:/x.png ~]";
    const items = transcriptToItems([{ role: "user", content: `${note}\n\n뭐가 보여?` }, { role: "user", content: note }]);
    expect(items.map((i) => "text" in i ? i.text : "")).toEqual(["뭐가 보여?", "[이미지]"]);
  });

  it("snapshot prefers display_messages", () => {
    const s = chatReducer(initialChat, { t: "snapshot", snap: { session_id: "a", messages: [{ role: "user", content: "raw" }], display_messages: [{ role: "user", text: "clean" }] } });
    expect(s.items).toEqual([expect.objectContaining({ text: "clean" })]);
  });

  it("localError appends an error but leaves running and the turn clock", () => {
    let s = chatReducer(initialChat, { t: "userSent", id: "u0", text: "q", at: 5 });
    s = chatReducer(s, { t: "localError", text: "boom" });
    expect(s.running).toBe(true);
    expect(s.turnStart).toBe(5);
    expect(s.items[s.items.length - 1]).toMatchObject({ kind: "error", text: "boom" });
  });

  it("snapshot keeps running background items and ends running subagents", () => {
    let s = chatReducer(initialChat, { t: "background", taskId: "b1", text: "job", at: 1 });
    s = chatReducer(s, { t: "event", ev: { type: "subagent.start", payload: { subagent_id: "c1" } } });
    s = chatReducer(s, { t: "snapshot", snap: { session_id: "a", messages: [] } });
    expect(s.items).toEqual([expect.objectContaining({ kind: "background", taskId: "b1", status: "running" })]);
    expect(s.subagents.c1.status).toBe("failed");
  });
});

describe("row ids", () => {
  const rows = [
    { role: "user", text: "a", row_id: 1 }, { role: "assistant", text: "A", row_id: 2 },
    { role: "user", text: "b", row_id: 4 }, { role: "user", text: "", row_id: 5 },
  ];
  it("user items carry their row id and the nearest earlier row id", () => {
    const u = transcriptToItems(rows).filter((i) => i.kind === "user");
    expect(u).toMatchObject([{ text: "a", rowId: 1 }, { text: "b", rowId: 4, prevRowId: 2 }]);
    expect((u[0] as any).prevRowId).toBeUndefined();
  });
  it("forkBoundary: through the previous row, or fresh for the first message", () => {
    const u = transcriptToItems(rows).filter((i) => i.kind === "user");
    expect(forkBoundary(u[1])).toEqual({ through: 2 });
    expect(forkBoundary(u[0])).toEqual({ fresh: true });
  });
  it("snapshot sets rowIds only when display_messages came", () => {
    expect(chatReducer(initialChat, { t: "snapshot", snap: { session_id: "s", display_messages: rows } }).rowIds).toBe(true);
    expect(chatReducer(initialChat, { t: "snapshot", snap: { session_id: "s", messages: rows } }).rowIds).toBe(false);
  });
  it("userActions: hidden without row ids, disabled while busy or unsaved", () => {
    const item = { kind: "user", id: "u", text: "x", rowId: 3 } as const;
    expect(userActions({ running: false, queued: [], rowIds: false }, item).show).toBe(false);
    expect(userActions({ running: true, queued: [], rowIds: true }, item)).toEqual({ show: true, enabled: false, reason: "작업 중에는 쓸 수 없습니다" });
    expect(userActions({ running: false, queued: [{} as any], rowIds: true }, item).reason).toBe("작업 중에는 쓸 수 없습니다");
    expect(userActions({ running: false, queued: [], rowIds: true }, { ...item, rowId: undefined })).toEqual({ show: true, enabled: false, reason: "저장되는 중" });
    expect(userActions({ running: false, queued: [], rowIds: true }, item)).toEqual({ show: true, enabled: true });
    expect(userActions({ running: false, queued: [], rowIds: true }, { kind: "system", id: "s", text: "x" }).show).toBe(false);
  });
});

describe("snapshot keepLocal", () => {
  const snap = { session_id: "s", display_messages: [{ role: "user", text: "a", row_id: 1 }] };
  let st = chatReducer(initialChat, { t: "snapshot", snap });
  st = chatReducer(chatReducer(st, { t: "localError", text: "boom" }), { t: "system", text: "note" });
  it("keeps local error/system rows after the transcript", () => {
    const n = chatReducer(st, { t: "snapshot", snap, keepLocal: true });
    expect(n.items.map((i) => i.kind)).toEqual(["user", "error", "system"]);
  });
  it("drops them without keepLocal", () => {
    expect(chatReducer(st, { t: "snapshot", snap }).items.map((i) => i.kind)).toEqual(["user"]);
  });
});

describe("post-turn resync annotates row ids", () => {
  const rows = [
    { role: "user", text: "a", row_id: 1 }, { role: "assistant", text: "A", row_id: 2 },
    { role: "user", text: "b", row_id: 3 }, { role: "tool", content: "out", tool_name: "x", row_id: 4 }, { role: "assistant", text: "B", row_id: 5 },
  ];
  const base = chatReducer(initialChat, { t: "snapshot", snap: { session_id: "s", revision: 1, display_messages: rows.slice(0, 2) } });
  let live = chatReducer(base, { t: "userSent", id: "u2", text: "b", submissionId: "q", at: 1 });
  live = chatReducer(live, { t: "event", ev: { type: "tool.start", payload: { tool_id: "t1", name: "x", inline_diff: "+1" } } });
  live = chatReducer(live, { t: "localError", text: "oops" });
  live = chatReducer(live, { t: "event", ev: { type: "message.complete", payload: { text: "B" } } });
  it("match: items identical except the new row ids; counters from the snapshot", () => {
    const n = chatReducer(live, { t: "snapshot", snap: { session_id: "s", revision: 7, execution_generation: 3, display_messages: rows }, keepLocal: true });
    expect(n.items.map((i) => i.id)).toEqual(live.items.map((i) => i.id));
    n.items.forEach((i, k) => { if (k !== 2) expect(i).toBe(live.items[k]); });
    expect(n.items[2]).toEqual({ ...live.items[2], rowId: 3, prevRowId: 2 });
    expect(n.revision).toBe(7);
    expect(n.executionGeneration).toBe(3);
    expect(n.rowIds).toBe(true);
  });
  it("mismatch (text differs) falls back to the replace", () => {
    const other = rows.map((r) => (r.row_id === 3 ? { ...r, text: "c" } : r));
    const n = chatReducer(live, { t: "snapshot", snap: { session_id: "s", display_messages: other }, keepLocal: true });
    expect(n.items.map((i) => i.kind)).toEqual(["user", "assistant", "user", "tool", "assistant", "error"]);
    expect(n.items[2]).toMatchObject({ text: "c", rowId: 3 });
  });
  it("mismatch (user count differs) returns null", () => {
    expect(annotateRows(live.items, rows.slice(0, 2))).toBeNull();
    expect(annotateRows(live.items, undefined)).toBeNull();
  });
  it("fallback re-keys kept local rows so a later local row does not collide", () => {
    let n = chatReducer(live, { t: "snapshot", snap: { session_id: "s", display_messages: [{ role: "user", text: "z", row_id: 9 }] }, keepLocal: true });
    n = chatReducer(n, { t: "localError", text: "again" });
    const ids = n.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("forThisPane", () => {
  it("drops frames of another session, keeps own and unnamed ones", () => {
    expect(forThisPane("child", ["parent", "parent"])).toBe(false);
    expect(forThisPane("parent", [null, "parent"])).toBe(true);
    expect(forThisPane(undefined, ["parent"])).toBe(true);
    expect(forThisPane("", ["parent"])).toBe(true);
    expect(forThisPane("x", [null, null])).toBe(true); // nothing known yet
  });
});

describe("rewind helpers", () => {
  it("rewindText reads string and array content", () => {
    expect(rewindText("hi")).toBe("hi");
    expect(rewindText([{ type: "text", text: "a" }, { type: "image_url" }, { type: "text", text: "b" }])).toBe("a\nb");
    expect(rewindText(undefined)).toBe("");
  });
  it("rewindFailure reads the gateway's detail", () => {
    const stale = "대화가 바뀌어 되감지 못했습니다";
    const refusal = (reason: string, detail?: string) => new RpcError(reason, 4001, { reason, field: "target_message_id", ...(detail ? { detail } : {}) });
    expect(rewindFailure(refusal("revision_conflict"))).toBe(stale);
    expect(rewindFailure(refusal("stale_generation"))).toBe(stale);
    expect(rewindFailure(refusal("invalid_params", "target user message is no longer in session history"))).toBe(stale);
    expect(rewindFailure(refusal("invalid_params", "compacted: target user message was summarized when the session was compressed")))
      .toBe("압축된 메시지라 되감을 수 없습니다: compacted: target user message was summarized when the session was compressed");
    expect(rewindFailure(new RpcError("session_busy", 4001, { reason: "session_busy" }))).toBe("작업 중에는 쓸 수 없습니다");
    expect(rewindFailure(new RpcError("runtime_draining", 4001, { reason: "runtime_draining" }))).toBe("runtime_draining");
    expect(rewindFailure(new Error("연결되지 않았습니다"))).toBe("연결되지 않았습니다");
  });
});
