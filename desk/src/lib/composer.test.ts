import { describe, expect, it } from "vitest";
import { applyCompletion, BLOCKED_SLASH, enterAction, imageExt, isSlashCommand, modelLabel, parseModelArg, parseSlash, toBase64 } from "./composer";

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
