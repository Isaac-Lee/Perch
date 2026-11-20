import { describe, expect, it } from "vitest";
import { applyCompletion, BLOCKED_SLASH, enterAction, historyStep, promptHistory, imageExt, isSlashCommand, modelLabel, parseModelArg, parseSlash, toBase64 } from "./composer";

describe("composer", () => {
  it("enter rules incl. Korean IME", () => {
    const k = (o: Partial<Parameters<typeof enterAction>[0]>) => enterAction({ key: "Enter", shiftKey: false, isComposing: false, keyCode: 13, ...o });
    expect(k({})).toBe("send");
    expect(k({ shiftKey: true })).toBe("newline");
    expect(k({ isComposing: true })).toBe("none");
    expect(k({ keyCode: 229 })).toBe("none");
    expect(k({ key: "a", keyCode: 65 })).toBe("none");
  });

  it("imageExt allow-list and toBase64", () => {
    expect(imageExt("image/png")).toBe("png");
    expect(imageExt("image/jpeg")).toBe("jpg");
    expect(imageExt("image/gif")).toBe("gif");
    expect(imageExt("image/webp")).toBe("webp");
    expect(imageExt("image/svg+xml")).toBeNull();
    expect(toBase64(new Uint8Array([104, 105]))).toBe("aGk=");
    expect(atob(toBase64(new Uint8Array(200000).fill(7))).length).toBe(200000);
  });

  it("modelLabel", () => {
    expect(modelLabel("nous/welcome")).toBe("Welcome");
    expect(modelLabel("anthropic/claude-sonnet-4.5")).toBe("Claude-sonnet-4.5");
    expect(modelLabel("gpt-5")).toBe("Gpt-5");
    expect(modelLabel("")).toBe("");
  });

  it("isSlashCommand: command at position 0 only, paths are prose", () => {
    for (const t of ["/", "/help", "/model gpt-5", "/goal a\nb", "/ x"]) expect(isSlashCommand(t)).toBe(true);
    for (const t of ["/usr/local/bin", "run /clean", " /help", "hello", ""]) expect(isSlashCommand(t)).toBe(false);
  });

  it("parseSlash lower-cases the name and keeps a multi-line arg", () => {
    expect(parseSlash("/Reasoning high")).toEqual({ name: "reasoning", arg: "high" });
    expect(parseSlash("/status")).toEqual({ name: "status", arg: "" });
    expect(parseSlash("/goal fix\n  the leak  ")).toEqual({ name: "goal", arg: "fix\n  the leak" });
    expect(parseSlash("/")).toEqual({ name: "", arg: "" });
    expect(BLOCKED_SLASH.has("new")).toBe(true);
  });

  it("applyCompletion: command vs argument completion", () => {
    expect(applyCompletion("/mo", { text: "model" }, 1)).toBe("/model ");
    expect(applyCompletion("/reasoning h", { text: "high" }, 11)).toBe("/reasoning high");
  });

  it("parseModelArg", () => {
    expect(parseModelArg("corp/x")).toEqual({ model: "corp/x", provider: "" });
    expect(parseModelArg("--provider corp corp/x")).toEqual({ model: "corp/x", provider: "corp" });
    expect(parseModelArg("corp/x --provider=corp --global")).toEqual({ model: "corp/x", provider: "corp" });
    expect(parseModelArg("--global --session")).toBeNull();
    expect(parseModelArg("reset")).toBeNull();
    expect(parseModelArg("")).toBeNull();
  });
});

describe("prompt history", () => {
  const it0 = (kind: string, text?: string) => ({ kind, text });
  it("promptHistory", () => {
    expect(promptHistory([it0("user", "a"), it0("assistant", "x"), it0("user", "  "), it0("user", "b"), it0("user", "b"), it0("user", "a")])).toEqual(["a", "b", "a"]);
  });
  const base = { key: "ArrowUp", shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, isComposing: false, keyCode: 38, menuOpen: false, text: "", selectionStart: 0, selectionEnd: 0, history: ["c", "b", "a"], index: -1, saved: "" };
  it("walks up, down, restores draft, stops at oldest", () => {
    let r = historyStep({ ...base, text: "draft", selectionStart: 5, selectionEnd: 5 })!;
    expect(r).toEqual({ index: 0, text: "c", saved: "draft" });
    r = historyStep({ ...base, ...r, selectionStart: 1, selectionEnd: 1 })!;
    expect(r).toEqual({ index: 1, text: "b", saved: "draft" });
    const down = { ...base, key: "ArrowDown" };
    r = historyStep({ ...down, ...r, selectionStart: 1, selectionEnd: 1 })!;
    expect(r.index).toBe(0);
    r = historyStep({ ...down, ...r, selectionStart: 1, selectionEnd: 1 })!;
    expect(r).toEqual({ index: -1, text: "draft", saved: "draft" });
    expect(historyStep({ ...down, ...r })).toBeNull();
    expect(historyStep({ ...base, index: 2, text: "a" })).toBeNull();
  });
  it("line conditions", () => {
    expect(historyStep({ ...base, text: "x\ny", selectionStart: 3, selectionEnd: 3 })).toBeNull();
    expect(historyStep({ ...base, text: "x\ny", selectionStart: 1, selectionEnd: 1 })).not.toBeNull();
    expect(historyStep({ ...base, key: "ArrowDown", index: 0, saved: "s", text: "x\ny", selectionStart: 1, selectionEnd: 1 })).toBeNull();
    expect(historyStep({ ...base, key: "ArrowDown", index: 0, saved: "s", text: "x\ny", selectionStart: 3, selectionEnd: 3 })).not.toBeNull();
  });
  it("ignored cases", () => {
    for (const o of [{ isComposing: true }, { keyCode: 229 }, { shiftKey: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { menuOpen: true }, { key: "a" }])
      expect(historyStep({ ...base, ...o })).toBeNull();
  });
});
