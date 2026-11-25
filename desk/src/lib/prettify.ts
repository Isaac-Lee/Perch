const VOID = new Set("br hr img input meta link area base col embed source track wbr".split(" "));
const RAW = new Set(["pre", "script", "style", "textarea"]);
const RAWMARK = "\u0000";

// Re-indents original JSON characters (no stringify, so numbers/escapes stay verbatim); input is already JSON.parse-valid.
function json(t: string): string {
  let out = "", d = 0, str = false;
  const nl = () => "\n" + "  ".repeat(d);
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (str) { out += c; if (c === "\\") out += t[++i]; else if (c === '"') str = false; continue; }
    if (/\s/.test(c)) continue;
    if (c === '"') { str = true; out += c; }
    else if (c === "{" || c === "[") { out += c; if (!/^\s*[}\]]/.test(t.slice(i + 1))) { d++; out += nl(); } }
    else if (c === "}" || c === "]") { if (/[{[]$/.test(out)) out += c; else { d--; out += nl() + c; } }
    else if (c === ",") out += "," + nl();
    else if (c === ":") out += ": ";
    else out += c;
  }
  return out;
}

// ponytail: regex tokenizer, not an HTML parser; attribute values containing `>` can mis-split. Upgrade: a real parser.
function markup(t: string): string {
  if (!/<[a-zA-Z]/.test(t)) return t;
  const re = /<!--[\s\S]*?-->|<![^>]*>|<\/?[a-zA-Z][^>]*>|[^<]+|</g;
  const name = (s: string) => /^<\/?([a-zA-Z][\w:-]*)/.exec(s)?.[1].toLowerCase() ?? "";
  const kind = (s: string) => (/^<\/[a-zA-Z]/.test(s) ? "close" : /^<[a-zA-Z]/.test(s) ? (/\/>$/.test(s) || VOID.has(name(s)) ? "self" : "open") : s[0] === "<" && s.length > 1 ? "self" : "text");
  const toks: string[] = [];
  const low = t.toLowerCase();
  for (let m; (m = re.exec(t)); ) {
    const s = m[0];
    if (kind(s) === "open" && RAW.has(name(s))) {
      const e = low.indexOf("</" + name(s), re.lastIndex), c = e < 0 ? -1 : low.indexOf(">", e);
      re.lastIndex = c < 0 ? t.length : c + 1;
      toks.push(RAWMARK + t.slice(m.index, re.lastIndex));
    } else toks.push(s);
  }
  const lines: string[] = [];
  let d = 0;
  const add = (s: string) => lines.push("  ".repeat(d) + s);
  const isText = (i: number) => toks[i] !== undefined && toks[i][0] !== RAWMARK && kind(toks[i]) === "text";
  for (let i = 0; i < toks.length; i++) {
    const s = toks[i], k = kind(s);
    if (s[0] === RAWMARK) add(s.slice(1));
    else if (k === "text") { const x = s.trim(); if (x) add(x); }
    else if (k === "close") { d = Math.max(0, d - 1); add(s); }
    else if (k === "self") add(s);
    else if (isText(i + 1) && toks[i + 2] !== undefined && kind(toks[i + 2]) === "close") { add(s + toks[i + 1].trim() + toks[i + 2]); i += 2; }
    else { add(s); d++; }
  }
  return lines.join("\n");
}

export function prettify(lang: string, text: string): string {
  const t = text.trim(), l = lang.trim().toLowerCase();
  if (t.length <= 80 || t.includes("\n")) return text;
  const k = /^(json|jsonc)$/.test(l) ? "j" : /^(html|xml|svg|vue|xhtml)$/.test(l) ? "m" : l ? "" : /^[{[]/.test(t) ? "j" : t[0] === "<" ? "m" : "";
  if (k === "j") { try { JSON.parse(t); } catch { return text; } return json(t); }
  return k === "m" ? markup(t) : text;
}
