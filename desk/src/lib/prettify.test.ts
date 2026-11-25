import { describe, expect, it } from "vitest";
import { prettify } from "./prettify";

const J = '{"a":1,"b":[1,2,{"c":"x, {y}: \\"z\\""}],"e":{},"f":[],"g":12345678901234567890,"h":1.0,"i":1e5,"j":null}';
describe("prettify json", () => {
  it("expands and keeps tokens", () => {
    const o = prettify("json", J);
    expect(o).toContain("\n");
    expect(JSON.parse(o)).toEqual(JSON.parse(J));
    expect(o).toContain("12345678901234567890");
    expect(o).toContain('"h": 1.0');
    expect(o).toContain('"i": 1e5');
    expect(o).toContain('"x, {y}: \\"z\\""');
    expect(o).toContain('"e": {}');
    expect(o).toContain('"f": []');
    expect(o).toContain('\n  "a": 1,\n');
  });
  it("unlabeled by first char; skips otherwise", () => {
    expect(prettify("", J)).toContain("\n");
    expect(prettify("ts", J)).toBe(J);
    expect(prettify("json", J.slice(0, -1))).toBe(J.slice(0, -1));
    expect(prettify("json", '{"a":1}')).toBe('{"a":1}');
    expect(prettify("json", J.replace(",", ",\n"))).toBe(J.replace(",", ",\n"));
  });
});
describe("prettify markup", () => {
  const H = '<div class="a"><p>hello<br>world</p><img src="x"><span>text</span><pre>  a  b <b>x</b></pre><script>if (a<b) {}</script></div></div>';
  it("expands", () => {
    expect(prettify("html", H)).toBe([
      '<div class="a">', "  <p>", "    hello", "    <br>", "    world", "  </p>", '  <img src="x">', "  <span>text</span>",
      "  <pre>  a  b <b>x</b></pre>", "  <script>if (a<b) {}</script>", "</div>", "</div>",
    ].join("\n"));
  });
  it("unlabeled / other", () => {
    expect(prettify("", H)).toContain("\n  <p>");
    expect(prettify("ts", H)).toBe(H);
    expect(prettify("html", "x".repeat(90))).toBe("x".repeat(90));
  });
});
