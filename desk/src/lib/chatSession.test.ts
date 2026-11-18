import { describe, expect, it } from "vitest";
import turn from "./__fixtures__/turn.jsonl?raw";
import { canSend, chatReducer, staleRetry, initialChat, shouldAutoReconnect, transcriptToItems, type ChatAction } from "./chatSession";

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
    expect(staleRetry(Object.assign(new Error("other"), { data }))).toBeNull();
    expect(staleRetry(new Error("stale_revision"))).toBeNull();
    expect(staleRetry(Object.assign(new Error("stale_revision"), { data: { revision: "x" } }))).toBeNull();
    expect(staleRetry("nope")).toBeNull();
  });
});
