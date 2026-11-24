import { describe, expect, it } from "vitest";
import { dropSide } from "./usePaneDrag";

describe("dropSide", () => {
  it("centre is null", () => expect(dropSide(0.5, 0.5)).toBeNull());
  it("edges", () => {
    expect(dropSide(0.05, 0.5)).toBe("left");
    expect(dropSide(0.95, 0.5)).toBe("right");
    expect(dropSide(0.5, 0.05)).toBe("top");
    expect(dropSide(0.5, 0.95)).toBe("bottom");
  });
  it("0.3 boundary is inside the edge zone, just past it is not", () => {
    expect(dropSide(0.3, 0.5)).toBe("left");
    expect(dropSide(0.31, 0.5)).toBeNull();
  });
  it("corner tie (dx === dy) goes to the horizontal side", () => {
    expect(dropSide(0.1, 0.1)).toBe("left");
    expect(dropSide(0.9, 0.9)).toBe("right");
  });
});
