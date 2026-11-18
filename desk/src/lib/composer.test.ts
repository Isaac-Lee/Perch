import { describe, expect, it } from "vitest";
import { enterAction, imageExt, modelLabel, toBase64 } from "./composer";

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
});
