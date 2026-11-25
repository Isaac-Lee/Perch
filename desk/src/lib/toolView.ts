// Pure display helpers for thought and tool rows. Title precedence and the item count follow the Hermes desktop app
// (fallback-model/index.ts: skillActivityTitle -> per-tool dynamic title -> generic; toolResultCount).
import type { ToolItem } from "./chatSession";

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** First non-empty line of the reasoning without markdown emphasis, max 60 chars; "" when empty. */
export function thoughtTitle(reasoning: string): string {
  const line = reasoning.split(/\r?\n/).map((l) => l.replace(/^[\s#>*-]+/, "").replace(/\*+|`/g, "").trim()).find(Boolean) ?? "";
  return cut(line, 60);
}

/** Non-empty entries of an object as compact [key, value] rows (strings cut at 300 chars, others JSON). */
export function kvRows(v: unknown, max = 300): [string, string][] {
  if (!isRec(v)) return [];
  return Object.entries(v).flatMap(([k, x]): [string, string][] => {
    if (x == null || x === "" || (Array.isArray(x) && !x.length)) return [];
    return [[k, cut(typeof x === "string" ? x : JSON.stringify(x), max)]];
  });
}

const parse = (s: string): unknown => { try { return JSON.parse(s); } catch { return undefined; } };

/** What to show for a finished call: key/value rows for a JSON object result, else plain text (an `output` string is shown as text). */
export function resultView(result?: string, resultText?: string): { rows: [string, string][]; text: string } {
  if (resultText) return { rows: [], text: resultText };
  if (!result) return { rows: [], text: "" };
  const o = parse(result);
  if (!isRec(o)) return { rows: [], text: result };
  const { output, ...rest } = o;
  return typeof output === "string" ? { rows: kvRows(rest), text: output } : { rows: kvRows(o), text: "" };
}

const COUNT_KEYS = ["count", "total", "result_count", "results_count", "num_results", "match_count", "matches_count", "file_count", "files_count", "item_count", "items_count", "search_count", "searches_count", "source_count", "sources_count", "document_count", "documents_count", "updated", "added", "removed", "deleted", "created", "changed", "processed", "steps"];
const COUNT_ARRAYS = ["results", "items", "matches", "files", "documents", "sources", "rows"];
const num = (v: unknown) => (Array.isArray(v) ? (v.length ? v.length : null) : typeof v === "number" && v > 0 ? Math.round(v) : null);
function countIn(r: Record<string, unknown>): number | null {
  for (const k of [...COUNT_KEYS, ...COUNT_ARRAYS]) { const n = num(r[k]); if (n !== null) return n; }
  for (const [k, v] of Object.entries(r)) { if (/_count$|_total$/i.test(k) && !["duration_s", "exit_code", "status_code"].includes(k)) { const n = num(v); if (n !== null) return n; } }
  return null;
}
/** Item count of a JSON result, derived like the desktop app (count-like fields, then known arrays, then *_count). */
export function resultCount(result?: string): number | null {
  const o = result ? parse(result) : undefined;
  if (!isRec(o)) return null;
  const direct = countIn(o);
  if (direct !== null) return direct;
  const payload = ["data", "result", "output", "response", "payload"].map((k) => o[k]).find((v) => v != null);
  return isRec(payload) ? countIn(payload) : null;
}

/** One-line title of a tool row. */
export function toolTitle(t: ToolItem): string {
  const a = t.args ?? {};
  const done = t.status !== "running";
  if (t.name === "skill_view" || t.name === "skills_list") {
    if (t.name === "skills_list") return done ? "스킬 목록" : "스킬 목록 불러오는 중";
    const target = [text(a.name), text(a.file_path)].filter(Boolean).join(" → ");
    const label = t.status === "error" ? "스킬 불러오기 실패" : done ? (a.file_path ? "스킬 자료 읽음" : "스킬 불러옴") : "스킬 불러오는 중";
    return target ? `${label}: ${target}` : label;
  }
  if (t.labels?.[0]) return t.labels[0];
  const cmd = text(a.command).split("\n")[0];
  if (t.name === "terminal" && cmd) return `${done ? "실행" : "실행 중"}: ${cut(cmd, 100)}`;
  if (t.name === "read_file" && text(a.path)) return `${done ? "읽음" : "읽는 중"}: ${cut(text(a.path), 100)}`;
  if (t.name === "web_search" && (text(a.query) || text(a.search_term))) return `${done ? "검색" : "검색 중"}: ${cut(text(a.query) || text(a.search_term), 80)}`;
  return [t.name, t.context || t.preview].filter(Boolean).join(" · ");
}

/** Cut long output and say how much is hidden, so a cut never looks like the whole result. */
export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n… (${s.length - n}자 더 있음)` : s);
