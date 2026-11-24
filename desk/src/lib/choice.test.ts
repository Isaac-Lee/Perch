import { describe, expect, it } from "vitest";
import { splitChoice, stripRecommended } from "./choice";

describe("splitChoice", () => {
  it.each([
    ["Plain", ["Plain", ""]],
    ["A — detail", ["A", "detail"]],
    ["A - detail", ["A", "detail"]],
    ["A: detail", ["A", "detail"]],
    ["A\ndetail", ["A", "detail"]],
    ["A: see b: c", ["A", "see b: c"]],
    ["a-b", ["a-b", ""]],
  ])("%j", (input, out) => expect(splitChoice(input)).toEqual(out));
  it("does not split when the label is over 60 chars", () => {
    const long = "x".repeat(61);
    expect(splitChoice(`${long}: d`)).toEqual([`${long}: d`, ""]);
  });
});

describe("stripRecommended", () => {
  it.each([
    ["A (Recommended)", "A"],
    ["Recommended", "Recommended"],
    ["class (Recommended) x", "class (Recommended) x"],
  ])("%j", (input, out) => expect(stripRecommended(input)).toBe(out));
});
