import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { highlight } from "./highlight";
import { prettify } from "./prettify";

export type Block =
  | { t: "p"; text: string } | { t: "h"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { t: "code"; lang: string; text: string; open: boolean; art?: true }   // open: no closing ``` yet; art: promoted from a paragraph
  | { t: "list"; ordered: boolean; start?: number; items: { text: string; children: Block[] }[] }
  | { t: "quote"; children: Block[] } | { t: "hr" }
  | { t: "table"; head: string[]; rows: string[][]; align?: string[] };

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)/;
const closes = (l: string, ch: string, len: number) => new RegExp(`^\\s{0,3}${ch}{${len},}\\s*$`).test(l);
const BOX = /[─-╿]/;
const ASCII_BORDER = /^\s*\+[-=]{2,}[-=+\s]*\+\s*$/; // +-----+   +----+
/** Any box-drawing character: such text needs the tight `art` line height so vertical strokes join. */
export const isArt = (text: string) => BOX.test(text);
/** Unfenced diagram: at least two lines drawn with box characters or +---+ borders. */
export const artLines = (lines: string[]) => lines.filter((l) => BOX.test(l) || ASCII_BORDER.test(l)).length;
const WIDE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/;
const has = (set: string, ch: string) => ch !== "" && set.includes(ch);
/** Display-only: redraws ASCII +--+ / | boxes with box-drawing characters (the copy button keeps the original). */
export function boxify(text: string): string {
  const lines = text.split("\n");
  if (lines.filter((l) => ASCII_BORDER.test(l)).length < 2) return text;
  // display-column grid: a wide char takes its cell plus an empty filler cell
  const grid = lines.map((l) => [...l].flatMap((ch) => (WIDE.test(ch) ? [ch, ""] : [ch])));
  const at = (r: number, c: number) => grid[r]?.[c] ?? "";
  return grid.map((row, r) => row.map((ch, c) => {
    if (ch === "+") {
      const L = has("-=+", at(r, c - 1)), R = has("-=+", at(r, c + 1));
      let U = has("|+", at(r - 1, c)), D = has("|+", at(r + 1, c));
      if (!U && !D) {
        // misaligned corner: no vertical neighbour in its column, look four cells either side
        const near = (k: number) => [-4, -3, -2, -1, 0, 1, 2, 3, 4].some((d) => has("|+", at(k, c + d)));
        U = near(r - 1);
        D = near(r + 1);
      }
      if (L && R && U && D) return "┼";
      if (L && R && D) return "┬";
      if (L && R && U) return "┴";
      if (U && D && R) return "├";
      if (U && D && L) return "┤";
      if (L && R) return "─";
      if (U && D) return "│";
      return R && D ? "┌" : L && D ? "┐" : R && U ? "└" : L && U ? "┘" : ch;
    }
    if (ch === "-" || ch === "=") {
      let s = c, e = c;
      while (row[s - 1] === ch) s--;
      while (row[e + 1] === ch) e++;
      return e - s >= 2 || row[s - 1] === "+" || row[e + 1] === "+" ? (ch === "-" ? "─" : "═") : ch;
    }
    // also convert a pipe with open sides (misaligned boxes); a wide-char filler "" on the left is not open
    const open = (c === 0 || row[c - 1] === " ") && (c === row.length - 1 || row[c + 1] === " ");
    return ch === "|" && (has("|+", at(r - 1, c)) || has("|+", at(r + 1, c)) || open) ? "│" : ch;
  }).join("")).join("\n");
}
const WALL = "│|┃║", JUNCTION = "┌┐└┘├┤┬┴┼│+|╔╗╚╝╠╣╦╩╬║┏┓┗┛┣┫┳┻╋┃╭╮╰╯";
const nWide = (a: string[]) => a.filter((c) => WIDE.test(c)).length;
/** Display-only: repairs box art drawn by character count (Hangul/CJK counted as one cell) by dropping padding spaces so walls meet the borders again. */
// ponytail: only lines whose walls match a border by character index are repaired; irregular miscounts and lines without spare spaces stay as they are.
export function realign(text: string): string {
  if (!WIDE.test(text)) return text;
  const rows = text.split("\n").map((l) => [...l]);
  const border = rows.map((r) => !nWide(r) && /[─━═-]{2,}/.test(r.join("")));
  const near = (i: number, d: number) => { for (let j = i + d; rows[j]; j += d) if (border[j]) return rows[j]; };
  return rows.map((r, i) => {
    const walls = r.flatMap((c, k) => (WALL.includes(c) ? [k] : []));
    if (walls.length < 2 || !nWide(r)) return r.join("");
    const ok = (R: string[], col: (k: number) => number) => walls.every((k) => has(JUNCTION, R[col(k)]));
    const ref = [near(i, -1), near(i, 1)].find((R) => R && ok(R, (k) => k) && !ok(R, (k) => k + nWide(r.slice(0, k))));
    if (!ref) return r.join("");
    const out = r.slice(0, walls[0] + 1);
    walls.slice(1).forEach((w, j) => {
      const seg = r.slice(walls[j] + 1, w);
      // drop one space per wide char: trailing first, then leading
      for (let n = nWide(seg); n > 0; n--) { if (seg.at(-1) === " ") seg.pop(); else if (seg[0] === " ") seg.shift(); else break; }
      out.push(...seg, r[w]);
    });
    return out.concat(r.slice(walls.at(-1)! + 1)).join("");
  }).join("\n");
}
/** Display-only: repairs character-count box art, then redraws ASCII boxes. */
export const tidyArt = (text: string) => boxify(realign(text));
const CONNECTOR_CHARS =/[\s|▼▲▶◀↓↑→←^:.+\-=<>]/g;
// a line made only of connector glyphs (| ▼ -> v ...), or an indented line holding an arrow/pipe
const isConnector = (l: string) =>
  l.replace(CONNECTOR_CHARS, "").replace(/(?<![\p{L}\p{N}])[vV](?![\p{L}\p{N}])/gu, "") === "" || (/^ {2}/.test(l) && /[|▼▲▶◀↓↑→←]/.test(l));
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
      while (i < lines.length && !closes(lines[i], f[1][0], f[1].length)) body.push(lines[i++]);
      const open = i >= lines.length;
      if (!open) i++;
      out.push({ t: "code", lang: f[2], text: body.join("\n"), open });
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
      const start = ordered ? parseInt(m[2]) : 1;
      out.push(start !== 1 ? { t: "list", ordered, start, items } : { t: "list", ordered, items });
      continue;
    }
    const para = [line];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i]) && !isTableStart(lines, i)) para.push(lines[i++]);
    const n = artLines(para);
    const prev = out[out.length - 1];
    // ponytail: heuristic; a prose line made only of arrows/punctuation right after an unfenced diagram joins it. Proper fix is for the model to fence the diagram.
    if (prev?.t === "code" && prev.art && (n >= 1 || para.every(isConnector))) prev.text += "\n\n" + para.join("\n");
    else if (n >= 2) out.push({ t: "code", lang: "", text: para.join("\n"), open: false, art: true });
    else out.push({ t: "p", text: para.join("\n") });
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
    // backslash escape, except inside Windows-path-looking words (C:\dir\*.txt, a\b\.claude stay verbatim)
    if (c === "\\" && /[!-/:-@[-`{-~]/.test(s[i + 1] ?? "")) {
      const ws = Math.max(s.lastIndexOf(" ", i), s.lastIndexOf("\n", i), s.lastIndexOf("\t", i)) + 1;
      const we = s.slice(i).search(/\s/);
      if (!/:\\|\\[\p{L}\p{N}]/u.test(s.slice(ws, we < 0 ? s.length : i + we))) { buf += s[i + 1]; i += 2; continue; }
    }
    if (c === "`" && s[i + 1] === "`") {
      let n = 2;
      while (s[i + n] === "`") n++;
      const run = "`".repeat(n);
      const e = s.indexOf(run, i + n);
      if (e < 0) { buf += run; i += n; continue; }
      let t = s.slice(i + n, e);
      if (t.length > 1 && t.startsWith(" ") && t.endsWith(" ")) t = t.slice(1, -1);
      push(<code key={k}>{t}</code>); i = e + n; continue;
    } else if (c === "`") {
      const e = s.indexOf("`", i + 1);
      if (e > i + 1) { push(<code key={k}>{s.slice(i + 1, e)}</code>); i = e + 1; continue; }
    } else if (c === "~" && s[i + 1] === "~") {
      const e = s.indexOf("~~", i + 2);
      if (e > i + 2) { push(<del key={k}>{inline(s.slice(i + 2, e), onLink)}</del>); i = e + 2; continue; }
    } else if (c === "<") {
      const br = /^<br\s*\/?>/i.exec(s.slice(i, i + 8));
      if (br) { buf += "\n"; i += br[0].length; continue; }
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

function CodeBlock({ lang, text, open }: { lang: string; text: string; open: boolean }) {
  const shown = useMemo(() => (/^(text|txt|plain|ascii)?$/i.test(lang) ? tidyArt(text) : text), [lang, text]);
  const hl = useMemo(() => {
    if (isArt(shown)) return highlight("text", shown);
    const p = open ? shown : prettify(lang, shown);
    return highlight(lang || (p === shown ? "" : p.trimStart()[0] === "<" ? "xml" : "json"), p); // prettify only changes JSON/markup
  }, [lang, shown, open]);
  const [done, setDone] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = () => {
    try {
      void navigator.clipboard.writeText(text).then(() => { setDone(true); clearTimeout(timer.current); timer.current = window.setTimeout(() => setDone(false), 1500); }, () => {});
    } catch { /* no clipboard */ }
  };
  return (
    <div className="md-code">
      <div className="md-code-head">
        <span>{lang || hl.lang}</span>
        <button type="button" className="md-copy" aria-live="polite" onClick={copy}>{done ? "복사됨" : "복사"}</button>
      </div>
      <pre className={isArt(shown) ? "art" : undefined}><code className="hljs-root" dangerouslySetInnerHTML={{ __html: hl.html }} /></pre>
    </div>
  );
}

const al = (a: string[] | undefined, j: number) => (a?.[j] ? { textAlign: a[j] as "left" } : undefined);

function render(blocks: Block[], onLink: OnLink): ReactNode[] {
  return blocks.map((b, i): ReactNode => {
    switch (b.t) {
      case "p": return <p key={i}>{inline(b.text, onLink)}</p>;
      case "h": { const H = `h${b.level}` as "h1"; return <H key={i}>{inline(b.text, onLink)}</H>; }
      case "code": return <CodeBlock key={i} lang={b.lang} text={b.text} open={b.open} />;
      case "hr": return <hr key={i} />;
      case "quote": return <blockquote key={i}>{render(b.children, onLink)}</blockquote>;
      case "list": {
        const L = b.ordered ? "ol" : "ul";
        return <L key={i} start={b.ordered ? b.start : undefined}>{b.items.map((it, j) => <li key={j}>{inline(it.text, onLink)}{render(it.children, onLink)}</li>)}</L>;
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
