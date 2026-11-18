import { describe, expect, it } from "vitest";
import { highlight } from "./highlight";

const types = (l: string, s: string) => highlight(l, s).map((x) => `${x.t}:${x.s}`);
const has = (l: string, s: string, t: string, piece: string) =>
  expect(highlight(l, s).some((x) => x.t === t && x.s === piece)).toBe(true);

describe("highlight", () => {
  it("round-trips", () => {
    const samples: [string, string][] = [
      ["diff", "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n c"],
      ["ts", 'const a = "x" // c\n/* b */ 0x1F 3.5'],
      ["python", "def f():\n  '''doc\nstring'''\n  return 1 # c"],
      ["json", '{"a": [1, true, null]}'],
      ["zzz", "anything"],
      ["ts", ""],
      ["ts", 'let s = "unterminated\nnext'],
      ["ts", "/* never closed"],
      ["go", "x := `raw\nstring"],
      ["", "@@ -1 +1 @@\n-a\n+b"],
    ];
    for (const [l, s] of samples) expect(highlight(l, s).map((x) => x.s).join("")).toBe(s);
  });
  it("diff", () => {
    has("diff", "+a", "add", "+a");
    has("diff", "-b", "del", "-b");
    has("diff", "@@ -1 +1 @@", "hunk", "@@ -1 +1 @@");
    has("diff", "--- a/x", "meta", "--- a/x");
    expect(types("", "@@ -1 +1 @@\n-a\n+b")).toEqual(["hunk:@@ -1 +1 @@\n", "del:-a\n", "add:+b"]);
  });
  it("ts", () => {
    has("ts", "// c", "com", "// c");
    has("TS", '"s"', "str", '"s"');
    has("ts", "42", "num", "42");
    has("ts", "const x", "kw", "const");
    expect(highlight("ts", "constant").some((x) => x.t === "kw")).toBe(false);
    expect(highlight("ts", "abc123").some((x) => x.t === "num")).toBe(false);
  });
  it("python vs c-like hash", () => {
    has("python", "# c", "com", "# c");
    expect(highlight("ts", "# c").some((x) => x.t === "com")).toBe(false);
  });
  it("unknown lang", () => {
    expect(highlight("zzz", "const a")).toEqual([{ t: "", s: "const a" }]);
    expect(highlight("", "const a")).toEqual([{ t: "", s: "const a" }]);
  });
  it("lone apostrophe is not a string", () => {
    const rs = "fn f<'a>(x: &'a str) {}";
    const toks = highlight("rust", rs);
    expect(toks.map((x) => x.s).join("")).toBe(rs);
    has("rust", rs, "kw", "fn");
    expect(toks.some((x) => x.t === "str")).toBe(false);
    has("ts", "'ok'", "str", "'ok'");
    const p = "don't stop\nnext";
    expect(highlight("yaml", p).map((x) => x.s).join("")).toBe(p);
    expect(highlight("yaml", p).some((x) => x.t === "str")).toBe(false);
  });
});
