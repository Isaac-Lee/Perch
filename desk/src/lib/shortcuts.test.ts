import { describe, expect, it } from "vitest";
import { formatShortcut, matchDigit, matchShortcut } from "./shortcuts";

const ev = (code: string, o: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) =>
  ({ ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, code, ...o });

describe("shortcuts", () => {
  it("matches", () => {
    expect(matchShortcut(ev("KeyN", { shiftKey: true }))).toBe("new");
    expect(matchShortcut(ev("KeyN"))).toBeNull();
    expect(matchShortcut(ev("KeyO", { shiftKey: true }))).toBe("window");
    expect(matchShortcut(ev("Tab"))).toBe("next");
    expect(matchShortcut(ev("Tab", { shiftKey: true }))).toBe("prev");
    expect(matchShortcut(ev("KeyN", { shiftKey: true, altKey: true }))).toBeNull();
  });
  it("formats", () => {
    expect(formatShortcut("new", false)).toBe("Ctrl+Shift+N");
    expect(formatShortcut("prev", true)).toBe("⌘⇧Tab");
  });
  it("digits", () => {
    expect(matchDigit(ev("Digit3"))).toBe(2);
    expect(matchDigit(ev("Digit3", { shiftKey: true }))).toBeNull();
    expect(matchDigit(ev("Digit0"))).toBeNull();
  });
});
