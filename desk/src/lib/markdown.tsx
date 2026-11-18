import { useMemo, type ReactNode } from "react";
import { highlight } from "./highlight";

export type Block =
  | { t: "p"; text: string } | { t: "h"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { t: "code"; lang: string; text: string; open: boolean }   // open: no closing ``` yet
  | { t: "list"; ordered: boolean; items: { text: string; children: Block[] }[] }
  | { t: "quote"; children: Block[] } | { t: "hr" }
  | { t: "table"; head: string[]; rows: string[][]; align?: string[] };

const FENCE = /^\s{0,3}```\s*([^\s`]*)/;
const FENCE_END = /^\s{0,3}```\s*$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*$/;
const HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

const isBlank = (l: string) => l.trim() === "";
const indentOf = (l: string) => l.length - l.trimStart().length;
// split a table row on unescaped pipes outside backtick code spans; `\|` unescapes to `|`
function cells(l: string): string[] {
  const s = l.trim().replace(/^\|/, "");
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && s[i + 1] === "|") { cur += "|"; i++; }
    else if (c === "`" && s.indexOf("`", i + 1) > 0) {
      const e = s.indexOf("`", i + 1);
      cur += s.slice(i, e + 1).replace(/\\\|/g, "|");
      i = e;
    } else if (c === "|") { out.push(cur.trim()); cur = ""; }
    else cur += c;
  }
  out.push(cur.trim());
  if (out.length > 1 && out[out.length - 1] === "") out.pop();
  return out;
}
const isTableStart = (lines: string[], i: number) =>
  lines[i].includes("|") && i + 1 < lines.length && lines[i + 1].includes("|") && TABLE_SEP.test(lines[i + 1]);
const startsBlock = (l: string) => FENCE.test(l) || HEADING.test(l) || HR.test(l) || l.startsWith(">") || ITEM.test(l);
const alignOf = (c: string) => (c.startsWith(":") ? (c.endsWith(":") ? "center" : "left") : c.endsWith(":") ? "right" : "");

function parseLines(lines: string[]): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }
    const f = FENCE.exec(line);
    if (f) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE_END.test(lines[i])) body.push(lines[i++]);
      const open = i >= lines.length;
      if (!open) i++;
      out.push({ t: "code", lang: f[1], text: body.join("\n"), open });
      continue;
    }
    const h = HEADING.exec(line);
    if (h) { out.push({ t: "h", level: h[1].length as 1, text: h[2] }); i++; continue; }
    if (HR.test(line)) { out.push({ t: "hr" }); i++; continue; }
    if (line.startsWith(">")) {
      const inner: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) inner.push(lines[i++].replace(/^> ?/, ""));
      out.push({ t: "quote", children: parseLines(inner) });
      continue;
    }
    if (isTableStart(lines, i)) {
      const head = cells(line);
      const align = cells(lines[i + 1]).map(alignOf);
      i += 2;
      const rows: string[][] = [];
      // keep the grid rectangular: pad short rows, drop extra cells
      while (i < lines.length && !isBlank(lines[i]) && lines[i].includes("|")) rows.push(head.map((_, k) => cells(lines[i])[k] ?? "")), i++;
      out.push(align.some(Boolean) ? { t: "table", head, rows, align } : { t: "table", head, rows });
      continue;
    }
    const m = ITEM.exec(line);
    if (m) {
      const base = m[1].length;
      const ordered = /\d/.test(m[2]);
      const items: { text: string; children: Block[] }[] = [];
      while (i < lines.length) {
        const im = ITEM.exec(lines[i]);
        if (!im || im[1].length > base || /\d/.test(im[2]) !== ordered) break;
        i++;
        const child: string[] = [];
        for (; i < lines.length; i++) {
          if (isBlank(lines[i])) {
            // a blank line stays inside the item only if indented content follows
            const next = lines.slice(i).find((l) => !isBlank(l));
            if (next !== undefined && indentOf(next) > base) { child.push(""); continue; }
            break;
          }
          if (indentOf(lines[i]) <= base) break;
          child.push(lines[i]);
        }
        const min = Math.min(...child.filter((l) => !isBlank(l)).map(indentOf), Infinity);
        items.push({ text: im[3], children: parseLines(child.map((l) => l.slice(Number.isFinite(min) ? min : 0))) });
        // skip blank lines between items of the same list
        let j = i;
        while (j < lines.length && isBlank(lines[j])) j++;
        const nm = j < lines.length ? ITEM.exec(lines[j]) : null;
        if (nm && nm[1].length <= base && /\d/.test(nm[2]) === ordered) i = j;
      }
      out.push({ t: "list", ordered, items });
      continue;
    }
    const para = [line];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i]) && !isTableStart(lines, i)) para.push(lines[i++]);
    out.push({ t: "p", text: para.join("\n") });
  }
  return out;
}

export function parseBlocks(text: string): Block[] {
  return parseLines(text.replace(/\r\n?/g, "\n").split("\n"));
}

type OnLink = (url: string) => void;
const isAlnum = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);

function link(url: string, label: ReactNode, key: number, onLink: OnLink) {
  return <a key={key} href={url} onClick={(e) => { e.preventDefault(); onLink(url); }}>{label}</a>;
}

// ponytail: unmatched markers rescan with indexOf, so worst case is quadratic on pathological input.
function inline(s: string, onLink: OnLink): ReactNode[] {
  const out: ReactNode[] = [];
  let buf = "";
  let i = 0;
  const flush = () => { if (buf) { out.push(buf); buf = ""; } };
  const push = (n: ReactNode) => { flush(); out.push(n); };
  while (i < s.length) {
    const c = s[i];
    const k = out.length;
    if (c === "`") {
      const e = s.indexOf("`", i + 1);
      if (e > i + 1) { push(<code key={k}>{s.slice(i + 1, e)}</code>); i = e + 1; continue; }
    } else if (c === "[") {
      const e = s.indexOf("](", i + 1);
      const close = e > 0 ? s.indexOf(")", e + 2) : -1;
      if (e > 0 && close > 0 && !s.slice(i + 1, e).includes("\n")) {
        const label = s.slice(i + 1, e);
        const url = s.slice(e + 2, close).trim();
        // non-http(s) targets (javascript:, file:, data:) are never emitted; only the label text stays
        push(/^https?:\/\/\S+$/i.test(url) ? link(url, inline(label, onLink), k, onLink) : <span key={k}>{label}</span>);
        i = close + 1;
        continue;
      }
    } else if (c === "*" && s[i + 1] === "*") {
      const e = s.indexOf("**", i + 2);
      if (e > i + 2) { push(<strong key={k}>{inline(s.slice(i + 2, e), onLink)}</strong>); i = e + 2; continue; }
    } else if ((c === "*" || c === "_") && s[i + 1] !== " " && !(c === "_" && isAlnum(s[i - 1]))) {
      const e = s.indexOf(c, i + 1);
      if (e > i + 1 && !(c === "_" && isAlnum(s[e + 1]))) { push(<em key={k}>{inline(s.slice(i + 1, e), onLink)}</em>); i = e + 1; continue; }
    } else if (c === "h" && !isAlnum(s[i - 1])) {
      const m = /^https?:\/\/[^\s<>]+/i.exec(s.slice(i, i + 2048));
      if (m) {
        const url = m[0].replace(/[.,;:!?)\]'"]+$/, "");
        if (/^https?:\/\/\S/i.test(url)) { push(link(url, url, k, onLink)); i += url.length; continue; }
      }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

function CodeBlock({ lang, text }: { lang: string; text: string }) {
  const toks = useMemo(() => highlight(lang, text), [lang, text]);
  return (
    <div className="md-code">
      <div className="md-code-head">
        <span>{lang}</span>
        <button type="button" className="md-copy" onClick={() => { try { void navigator.clipboard.writeText(text).catch(() => {}); } catch { /* no clipboard */ } }}>복사</button>
      </div>
      <pre><code>{toks.map((k, i) => k.t ? <span key={i} className={"hl-" + k.t}>{k.s}</span> : k.s)}</code></pre>
    </div>
  );
}

const al = (a: string[] | undefined, j: number) => (a?.[j] ? { textAlign: a[j] as "left" } : undefined);

function render(blocks: Block[], onLink: OnLink): ReactNode[] {
  return blocks.map((b, i): ReactNode => {
    switch (b.t) {
      case "p": return <p key={i}>{inline(b.text, onLink)}</p>;
      case "h": { const H = `h${b.level}` as "h1"; return <H key={i}>{inline(b.text, onLink)}</H>; }
      case "code": return <CodeBlock key={i} lang={b.lang} text={b.text} />;
      case "hr": return <hr key={i} />;
      case "quote": return <blockquote key={i}>{render(b.children, onLink)}</blockquote>;
      case "list": {
        const L = b.ordered ? "ol" : "ul";
        return <L key={i}>{b.items.map((it, j) => <li key={j}>{inline(it.text, onLink)}{render(it.children, onLink)}</li>)}</L>;
      }
      case "table":
        return (
          <table key={i} className="md-table">
            <thead><tr>{b.head.map((c, j) => <th key={j} style={al(b.align, j)}>{inline(c, onLink)}</th>)}</tr></thead>
            <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k} style={al(b.align, k)}>{inline(c, onLink)}</td>)}</tr>)}</tbody>
          </table>
        );
    }
  });
}

export function Markdown({ text, onLink }: { text: string; onLink: (url: string) => void }) {
  return <div className="md">{render(parseBlocks(text), onLink)}</div>;
}
