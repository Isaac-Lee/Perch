import { describe, expect, it } from "vitest";
import { pressOrder, strayClickButton } from "./strayClick";

const field = { tagName: "TEXTAREA", getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 20 }) };
const button = { id: "edit" };
const at = (x: number) => ({ closest: (sel: string) => (sel === "button:not(:disabled)" && x > 200 ? button : null) });

describe("strayClickButton", () => {
  it("passes a field's click that landed on a button elsewhere to that button", () => {
    expect(strayClickButton(field, 250, 300, at)).toBe(button);
  });
  it("leaves clicks inside the field, on non-buttons, or on other elements alone", () => {
    expect(strayClickButton(field, 50, 10, at)).toBeNull();
    expect(strayClickButton(field, 150, 300, at)).toBeNull();
    expect(strayClickButton({ ...field, tagName: "DIV" }, 250, 300, at)).toBeNull();
    expect(strayClickButton(null, 250, 300, at)).toBeNull();
  });
});

describe("pressOrder", () => {
  it("flags a press whose release came first", () => {
    const o = pressOrder();
    o.up(5, 5, 100);
    expect(o.down(5, 5, 120)).toBe(true);
  });
  it("leaves normal clicks and double clicks alone", () => {
    const o = pressOrder();
    expect(o.down(5, 5, 0)).toBe(false);
    o.up(5, 5, 50);
    expect(o.down(5, 5, 150)).toBe(false);
    o.up(5, 5, 200);
  });
  it("ignores an early release elsewhere or long ago", () => {
    const o = pressOrder();
    o.up(5, 5, 0);
    expect(o.down(9, 9, 10)).toBe(false);
    o.up(1, 1, 20); // a normal release
    o.up(5, 5, 100);
    expect(o.down(5, 5, 5000)).toBe(false);
  });
});
