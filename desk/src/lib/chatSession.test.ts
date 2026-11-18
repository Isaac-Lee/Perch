import { describe, expect, it } from "vitest";
import turn from "./__fixtures__/turn.jsonl?raw";
import { activityLabel, canSend, chatReducer, fmtSec, groupItems, staleRetry, initialChat, shouldAutoReconnect, toDirective, toModelProviders, transcriptToItems, type ChatAction } from "./chatSession";

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
    expect(activityLabel({ ...base, items: [tool("running")], prompts: prompt })).toBe("응답 대기 중");
    expect(activityLabel({ ...base, items: [tool("running", "a", ""), tool("running")] })).toBe("terminal · npm test");
    expect(activityLabel({ ...base, items: [tool("running", "mcp", "x", "42%")] })).toBe("mcp · x · 42%");
    expect(activityLabel({ ...base, items: [tool("done")], generating: "terminal", status: "pondering..." })).toBe("terminal 준비 중");
    expect(activityLabel({ ...base, items: [tool("done")], status: "pondering..." })).toBe("pondering...");
    expect(activityLabel({ ...base, items: [{ kind: "thought", id: "r", text: "x", streaming: true }] })).toBe("생각 중");
    expect(activityLabel({ ...base, items: [tool("done"), { kind: "assistant", id: "m", text: "x", streaming: true }] })).toBe("답변 작성 중");
    expect(activityLabel({ ...base, items: [tool("done")] })).toBe("생각 중");
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

