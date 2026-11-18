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
});
