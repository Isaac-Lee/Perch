// ponytail: regex-family tokenizer, not a real grammar; swap for highlight.js if accuracy matters.
export type Tok = { t: "" | "com" | "str" | "num" | "kw" | "add" | "del" | "hunk" | "meta"; s: string };

type Cfg = { line?: string; block?: [string, string]; ticks?: boolean; triple?: boolean; life?: boolean; kw?: Set<string>; ci?: boolean };

const W = (s: string) => new Set(s.split(" "));
const KW = W("if else for while do switch case default break continue return function const let var class extends new this super import from export as async await try catch finally throw typeof instanceof in of yield static public private protected interface type enum implements package namespace void null undefined true false fn func pub use struct impl mut match mod trait where self def lambda pass with is not and or None True False nil elif end then local unless begin fi done echo select go defer chan range map int string bool");
const SQL = W("select insert update delete from where join left right inner outer on group by order having limit into values set create table drop alter index null and or not as distinct union case when then else end true false");
const JSON_KW = W("true false null");

const C: Cfg = { line: "//", block: ["/*", "*/"], ticks: true, kw: KW };
const HASH: Cfg = { line: "#", ticks: true, triple: true, kw: KW };
const CFG: Record<string, Cfg> = {};
const reg = (names: string, c: Cfg) => names.split(" ").forEach((n) => (CFG[n] = c));
reg("rust rs", { ...C, life: true });
reg("js jsx ts tsx javascript typescript java c h cpp c++ cs csharp go kotlin kt swift php scala dart", C);
reg("py python sh bash zsh shell console yaml yml toml rb ruby ps1 powershell dockerfile makefile r perl ini", HASH);
reg("sql", { line: "--", block: ["/*", "*/"], kw: SQL, ci: true });
reg("lua", { line: "--", kw: KW });
reg("css scss less", { block: ["/*", "*/"] });
reg("json", { kw: JSON_KW });
reg("jsonc", { line: "//", block: ["/*", "*/"], kw: JSON_KW });
reg("html xml svg vue", { block: ["<!--", "-->"] });

const NUM = /0[xX][\da-fA-F]+|\d+(?:\.\d+)?/y;
const IDENT = /[A-Za-z_$][\w$]*/y;

function diff(text: string): Tok[] {
  return text.split(/(?<=\n)/).map((s): Tok => {
    const t = /^(\+\+\+|---|diff |index )/.test(s) ? "meta" : s.startsWith("@@") ? "hunk" : s[0] === "+" ? "add" : s[0] === "-" ? "del" : "";
    return { t, s };
  });
}

function scan(c: Cfg, text: string): Tok[] {
  const out: Tok[] = [];
  const push = (t: Tok["t"], s: string) => {
    const last = out[out.length - 1];
    if (last && last.t === t) last.s += s;
    else out.push({ t, s });
  };
  const n = text.length;
  let i = 0;
  while (i < n) {
    const ch = text[i];
    let end = -1;
    let t: Tok["t"] = "";
    if (c.line && text.startsWith(c.line, i)) {
      t = "com";
      end = text.indexOf("\n", i);
      if (end < 0) end = n;
    } else if (c.block && text.startsWith(c.block[0], i)) {
      t = "com";
      end = text.indexOf(c.block[1], i + c.block[0].length);
      end = end < 0 ? n : end + c.block[1].length;
    } else if (ch === '"' || ch === "'" || (ch === "`" && c.ticks)) {
      t = "str";
      const q = c.triple && text.startsWith(ch.repeat(3), i) ? ch.repeat(3) : ch;
      let j = i + q.length;
      let closed = false;
      // lone ' (apostrophe, lifetime) is plain; rust lifetimes can look closed across `'a>(x: &'`
      const life = c.life && ch === "'" && /^'[A-Za-z_]\w*(?!['\w])/.test(text.slice(i, i + 40));
      for (; j < n && !life; j++) {
        if (text[j] === "\\") j++;
        else if (text.startsWith(q, j)) { j += q.length; closed = true; break; }
        else if (text[j] === "\n" && q.length === 1 && ch !== "`") break;
      }
      end = Math.min(j, n);
      if (ch === "'" && q.length === 1 && !closed) { t = ""; end = i + 1; }
    } else if (/\d/.test(ch)) {
      NUM.lastIndex = i;
      t = "num";
      end = i + NUM.exec(text)![0].length;
    } else if (/[A-Za-z_$]/.test(ch)) {
      IDENT.lastIndex = i;
      const w = IDENT.exec(text)![0];
      end = i + w.length;
      t = c.kw?.has(c.ci ? w.toLowerCase() : w) ? "kw" : "";
    }
    if (end < 0) end = i + 1;
    push(t, text.slice(i, end));
    i = end;
  }
  return out;
}

export function highlight(lang: string, text: string): Tok[] {
  const l = lang.trim().toLowerCase();
  const isDiff = l === "diff" || l === "patch" ||
    (l === "" && /^@@ /m.test(text) && /^[+-]/m.test(text));
  if (isDiff) return diff(text);
  const c = CFG[l];
  return c ? scan(c, text) : [{ t: "", s: text }];
}
