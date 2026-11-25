import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown, parseBlocks } from "./markdown";

const md = (text: string) => renderToStaticMarkup(<Markdown text={text} onLink={() => {}} />);

describe("markdown", () => {
  it("blocks", () => {
    expect(parseBlocks("# T\n\npara one\nstill\n\n---\n")).toEqual([{ t: "h", level: 1, text: "T" }, { t: "p", text: "para one\nstill" }, { t: "hr" }]);
    expect(parseBlocks("```ts\nconst a = 1;\n```")).toEqual([{ t: "code", lang: "ts", text: "const a = 1;", open: false }]);
    expect(parseBlocks("```py\nprint(1)")).toEqual([{ t: "code", lang: "py", text: "print(1)", open: true }]); // streaming
    expect(parseBlocks("- a\n  - b\n- c")).toEqual([{ t: "list", ordered: false, items: [
      { text: "a", children: [{ t: "list", ordered: false, items: [{ text: "b", children: [] }] }] }, { text: "c", children: [] }] }]);
    expect(parseBlocks("1. x\n2. y")[0]).toMatchObject({ t: "list", ordered: true });
    expect(parseBlocks("| a | b |\n|---|---|\n| 1 | 2 |")).toEqual([{ t: "table", head: ["a", "b"], rows: [["1", "2"]] }]);
    expect(parseBlocks("> q")).toEqual([{ t: "quote", children: [{ t: "p", text: "q" }] }]);
  });
  it("inline and links", () => {
    const html = renderToStaticMarkup(<Markdown text={"**b** *i* `c` [x](https://a.b/c) https://d.e [bad](javascript:alert(1))"} onLink={() => {}} />);
    expect(html).toContain("<strong>b</strong>"); expect(html).toContain("<em>i</em>"); expect(html).toContain("<code>c</code>");
    expect(html).toContain('href="https://a.b/c"'); expect(html).toContain('href="https://d.e"');
    expect(html).not.toContain("javascript:");
  });
  it("does not interpret markdown inside code", () => {
    expect(renderToStaticMarkup(<Markdown text={"```\n**x** <b>\n```"} onLink={() => {}} />)).toContain("**x** &lt;b&gt;");
    expect(md("`**x**`")).toContain("<code>**x**</code>");
  });
  it("renders the Review Focus case: lone fence and empty text do not throw", () => {
    for (const t of ["```", "", "|", "- ", "**", "[x](", "> ", "#", "| a |\n|", "_", "1."]) expect(() => md(t)).not.toThrow();
    expect(md("```")).toContain("md-code");
  });
  it("code block has label and copy button; table and heading render", () => {
    const html = md("```ts\nx\n```\n\n## H\n\n| a |\n|---|\n| 1 |");
    expect(html).toContain("md-code-head"); expect(html).toContain("md-copy"); expect(html).toContain("복사"); expect(html).toContain("ts");
    expect(html).toContain("<h2>H</h2>"); expect(html).toContain("md-table"); expect(html).toContain("<td>1</td>");
  });
  it("nested ordered list and mixed blocks", () => {
    expect(parseBlocks("1. a\n   - b\n2. c")).toEqual([{ t: "list", ordered: true, items: [
      { text: "a", children: [{ t: "list", ordered: false, items: [{ text: "b", children: [] }] }] }, { text: "c", children: [] }] }]);
    expect(parseBlocks("text\n- a")).toEqual([{ t: "p", text: "text" }, { t: "list", ordered: false, items: [{ text: "a", children: [] }] }]);
  });
  it("tables", () => {
    const T = (head: string[], rows: string[][], align?: string[]) => ({ t: "table", head, rows, ...(align ? { align } : {}) });
    // 1 directly after a paragraph line
    expect(parseBlocks("다음은 비교표입니다:\n| a | b |\n|---|---|\n| 1 | 2 |")).toEqual([{ t: "p", text: "다음은 비교표입니다:" }, T(["a", "b"], [["1", "2"]])]);
    // 2 inside a list item
    expect(parseBlocks("- item\n  | a | b |\n  |---|---|\n  | 1 | 2 |")).toEqual([{ t: "list", ordered: false, items: [{ text: "item", children: [T(["a", "b"], [["1", "2"]])] }] }]);
    expect(md("- item\n  | a |\n  |---|\n  | 1 |")).toMatch(/<li>item<table/);
    // 3 leading spaces
    expect(parseBlocks("   | a | b |\n   |---|---|\n   | 1 | 2 |")).toEqual([T(["a", "b"], [["1", "2"]])]);
    // 4 no outer pipes
    expect(parseBlocks("a | b\n--- | ---\n1 | 2")).toEqual([T(["a", "b"], [["1", "2"]])]);
    // 5 escaped pipe stays in the cell; pipe in a code span does not split
    expect(parseBlocks("| a | b |\n|---|---|\n| x\\|y | `a|b` |")).toEqual([T(["a", "b"], [["x|y", "`a|b`"]])]);
    expect(md("| a |\n|---|\n| `a|b` |")).toContain("<td><code>a|b</code></td>");
    // 6 ragged rows
    expect(parseBlocks("| a | b |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |")).toEqual([T(["a", "b"], [["1", ""], ["1", "2"]])]);
    // 7 alignment
    expect(parseBlocks("| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |")).toEqual([T(["a", "b", "c"], [["1", "2", "3"]], ["left", "center", "right"])]);
    const html = md("| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |");
    expect(html).toContain('<th style="text-align:left">'); expect(html).toContain('<td style="text-align:center">'); expect(html).toContain('<td style="text-align:right">3</td>');
    // 8 streaming
    expect(() => md("| a | b |\n|---|---|\n| 1")).not.toThrow();
    expect(parseBlocks("| a | b |\n|---|---|\n| 1")).toEqual([T(["a", "b"], [["1", ""]])]);
    // 9 no false positives
    expect(parseBlocks("run cat x | grep y\nthen more")).toEqual([{ t: "p", text: "run cat x | grep y\nthen more" }]);
    expect(parseBlocks("text\ncat x | grep y\n---")[0]).toMatchObject({ t: "p" });
  });

  it("fences: 4 backticks and ~~~", () => {
    const b = parseBlocks("````md\n```js\nx\n```\n````\nafter");
    expect(b).toEqual([{ t: "code", lang: "md", text: "```js\nx\n```", open: false }, { t: "p", text: "after" }]);
    expect(parseBlocks("~~~\na\n~~~\nb")).toEqual([{ t: "code", lang: "", text: "a", open: false }, { t: "p", text: "b" }]);
  });
  it("ordered list keeps its start number across a code block", () => {
    const t = "1. a\n```\nc\n```\n2. b";
    expect(parseBlocks(t)[2]).toMatchObject({ t: "list", ordered: true, start: 2 });
    expect(renderToStaticMarkup(<Markdown text={t} onLink={() => {}} />)).toContain('<ol start="2">');
  });
  it("unfenced box diagram becomes art code; prose with one rule stays a paragraph", () => {
    const d = "┌──────┐\n│ 한글 │\n└──────┘";
    expect(parseBlocks(d + "\n\n   │")).toEqual([{ t: "code", lang: "", text: d + "\n\n   │", open: false, art: true }]);
    expect(parseBlocks("가나다 ─ 라마바")).toEqual([{ t: "p", text: "가나다 ─ 라마바" }]);
    expect(renderToStaticMarkup(<Markdown text={"```\n│ 한글 │\n```"} onLink={() => {}} />)).toContain('<pre class="art">');
  });
  it("inline br, strike, double-backtick code", () => {
    const h = (t: string) => renderToStaticMarkup(<Markdown text={t} onLink={() => {}} />);
    expect(h("a<br>b")).toContain("a\nb");
    expect(h("a<br>b")).not.toContain("<br");
    expect(h("~~x~~")).toContain("<del>x</del>");
    expect(h("``a`b``")).toContain("<code>a`b</code>");
  });
});
