import hljs from "highlight.js/lib/common";
import powershell from "highlight.js/lib/languages/powershell";
import dockerfile from "highlight.js/lib/languages/dockerfile";

hljs.registerLanguage("powershell", powershell);
hljs.registerLanguage("dockerfile", dockerfile);
hljs.registerAliases(["jsonc"], { languageName: "json" });
hljs.registerAliases(["ps1", "pwsh"], { languageName: "powershell" });

const AUTO = ["typescript", "javascript", "python", "json", "bash", "xml", "rust", "go", "java", "sql", "powershell"];
const MIN_RELEVANCE = 10; // probed: prose/log/tree score <= 5, multi-line real snippets >= 11; short snippets stay plain on purpose
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

export function highlight(lang: string, text: string): { html: string; lang: string } {
  const plain = { html: esc(text), lang: "" };
  const l = lang.trim().toLowerCase();
  try {
    if (/^(text|txt|plain|plaintext|ascii)$/.test(l)) return plain;
    if (l) {
      const g = hljs.getLanguage(l);
      return g ? { html: hljs.highlight(text, { language: l, ignoreIllegals: true }).value, lang: g.name ?? l } : plain;
    }
    if (/^@@ /m.test(text) && /^[+-]/m.test(text)) return { html: hljs.highlight(text, { language: "diff" }).value, lang: "diff" };
    if (text.length > 20000) return plain;
    const r = hljs.highlightAuto(text, AUTO);
    return r.language && r.relevance >= MIN_RELEVANCE ? { html: r.value, lang: r.language } : plain;
  } catch {
    return plain;
  }
}
