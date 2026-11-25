import { describe, expect, it } from "vitest";
import { highlight } from "./highlight";

const plainOf = (h: string) => h.replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
const JS = "import fs from 'fs';\nconst data = fs.readFileSync('a.txt', 'utf8');\nasync function main() {\n  const r = await fetch(url);\n  console.log(await r.json());\n}\nmain();";
const PY = "import os\nfrom typing import List\n\nclass A:\n    def __init__(self, x):\n        self.x = x\n\n    def run(self):\n        for i in range(10):\n            print(i)\n";

describe("highlight", () => {
  it("round-trips", () => {
    const samples: [string, string][] = [
      ["diff", "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n c"],
      ["ts", 'const a = "x" // c\n/* b */ 0x1F 3.5 <T>&'],
      ["python", "def f():\n  '''doc\nstring'''\n  return 1 # c"],
      ["json", '{"a": [1, true, null]}'],
      ["zzz", "anything <b>"],
      ["ts", ""],
      ["ts", 'let s = "unterminated\nnext'],
      ["ts", "/* never closed"],
      ["go", "x := `raw\nstring"],
      ["", "@@ -1 +1 @@\n-a\n+b"],
      ["", JS],
      ["", "├── src\n└── a & b"],
    ];
    for (const [l, s] of samples) expect(plainOf(highlight(l, s).html)).toBe(s);
  });
  it("ts", () => {
    const { html, lang } = highlight("TS", 'const x = "s"; // c');
    expect(html).toContain('<span class="hljs-keyword">const</span>');
    expect(html).toContain("hljs-string");
    expect(html).toContain("hljs-comment");
    expect(lang).not.toBe("");
  });
  it("json keys differ from values", () => {
    const { html } = highlight("json", '{"k": "v"}');
    expect(html).toContain('<span class="hljs-attr">&quot;k&quot;</span>');
    expect(html).toContain('<span class="hljs-string">&quot;v&quot;</span>');
  });
  it("diff", () => {
    const { html } = highlight("diff", "@@ -1 +1 @@\n-a\n+b");
    expect(html).toContain('<span class="hljs-deletion">-a</span>');
    expect(html).toContain('<span class="hljs-addition">+b</span>');
    expect(highlight("", "@@ -1 +1 @@\n-a\n+b").lang).toBe("diff");
  });
  it("auto-detects code", () => {
    for (const [s, l] of [[JS, "javascript"], [PY, "python"]]) {
      const r = highlight("", s);
      expect(r.lang).toBe(l);
      expect(r.html).toContain("hljs-keyword");
    }
  });
  it("leaves prose, logs, trees plain", () => {
    for (const s of [
      "This is a normal paragraph of text. It explains that we should use the function when the value is set, and then return to the caller.",
      "2026-01-01 12:00:01 INFO server started on port 8080\n2026-01-01 12:00:02 WARN slow request took 1200ms\n2026-01-01 12:00:03 ERROR failed to connect: timeout",
      "├── src\n│   ├── lib\n│   │   └── a.ts\n│   └── main.tsx\n└── package.json",
      "┌──────┐\n│ a    │──▶ b\n└──────┘",
    ]) {
      const r = highlight("", s);
      expect(r.lang).toBe("");
      expect(r.html).not.toContain("<span");
    }
  });
  it("unknown / text langs are plain", () => {
    for (const l of ["zzz", "text", "plaintext"]) expect(highlight(l, "const a = 1")).toEqual({ html: "const a = 1", lang: "" });
  });
  it("escapes markup", () => {
    for (const l of ["", "html", "ts", "zzz", "text", "diff"]) expect(highlight(l, "<script>alert(1)</script>").html).not.toContain("<script");
  });
  it("empty", () => {
    expect(highlight("", "")).toEqual({ html: "", lang: "" });
    expect(highlight("ts", "").html).toBe("");
  });
});
