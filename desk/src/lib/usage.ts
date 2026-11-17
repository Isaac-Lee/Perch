import type { AgentKind, Session, Usage } from "./types";
import { COMMON_LABEL, projectLabels } from "./groups";

export type ChartRange = "14d" | "30d" | "1y";
export type ChartBucket = "day" | "week";
export interface ChartPoint { key: string; label: string; title: string; total: number }
export type Period = "today" | "7d" | "30d" | "all";

export function totalTokens(u: Usage): number {
  return u.input + u.output + u.cacheRead + u.cacheWrite; // reasoning is already part of output
}

export function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  const f = (v: number, d: number) => String(Number(v.toFixed(d)));
  if (n < 1_000_000) return `${f(n / 1000, 1)}k`;
  return `${f(n / 1_000_000, 2)}M`;
}

export interface UsageRow { key: string; label: string; sessions: number; input: number; output: number; cache: number; total: number; costUsd: number | null }
type SessionRow = UsageRow & { sessionId: string; agent: AgentKind; startedAt: number };

const DAY = 86400;
const pad = (n: number) => String(n).padStart(2, "0");
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function since(period: Period, now: number): number {
  if (period === "today") { const d = new Date(now * 1000); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000; }
  return period === "7d" ? now - 7 * DAY : period === "30d" ? now - 30 * DAY : -Infinity;
}

const blank = (key: string, label: string): UsageRow => ({ key, label, sessions: 0, input: 0, output: 0, cache: 0, total: 0, costUsd: null });
function add(r: UsageRow, u: Usage) {
  r.sessions++; r.input += u.input; r.output += u.output; r.cache += u.cacheRead + u.cacheWrite; r.total += totalTokens(u);
  if (u.costUsd != null) r.costUsd = (r.costUsd ?? 0) + u.costUsd;
}

export function summarize(sessions: Session[], period: Period, now: number) {
  const withUsage = sessions.filter((s): s is Session & { usage: Usage } => s.usage !== null);
  const from = since(period, now);
  const inPeriod = withUsage.filter((s) => s.usage.startedAt >= from);
  const labels = projectLabels(inPeriod.flatMap((s) => (s.repoRoot ? [s.repoRoot] : [])));

  const total = blank("total", "Total");
  const groups = { project: new Map<string, UsageRow>(), model: new Map<string, UsageRow>(), agent: new Map<string, UsageRow>() };
  const bump = (m: Map<string, UsageRow>, key: string, label: string, u: Usage) => {
    let r = m.get(key);
    if (!r) m.set(key, (r = blank(key, label)));
    add(r, u);
  };
  const bySession: SessionRow[] = [];
  let apiCalls = 0;
  for (const s of inPeriod) {
    const u = s.usage;
    add(total, u);
    apiCalls += u.apiCalls;
    bump(groups.project, s.repoRoot ?? "common", s.repoRoot ? labels.get(s.repoRoot)! : COMMON_LABEL, u);
    bump(groups.model, u.model, u.model, u);
    bump(groups.agent, s.agent, s.agent, u);
    const row = blank(s.sessionId, s.prompt);
    add(row, u);
    bySession.push({ ...row, sessionId: s.sessionId, agent: s.agent, startedAt: u.startedAt });
  }
  const desc = (a: UsageRow, b: UsageRow) => b.total - a.total;

  return {
    total, apiCalls,
    byProject: [...groups.project.values()].sort(desc),
    byModel: [...groups.model.values()].sort(desc),
    byAgent: [...groups.agent.values()].sort(desc),
    bySession: bySession.sort(desc),
  };
}

const RANGE_DAYS = { "14d": 14, "30d": 30, "1y": 365 } as const;
const RANGE_WEEKS = { "14d": 2, "30d": 5, "1y": 53 } as const;

// Buckets by local usage.startedAt; empty buckets are kept; oldest -> newest, last bucket contains `now`.
export function chartSeries(sessions: Session[], range: ChartRange, bucket: ChartBucket, now: number): ChartPoint[] {
  const t = new Date(now * 1000);
  const [y, m, d] = [t.getFullYear(), t.getMonth(), t.getDate()];
  const mondayOffset = (date: Date) => (date.getDay() + 6) % 7; // days since Monday
  const bucketKey = (date: Date) => dayKey(bucket === "day" ? date : new Date(date.getFullYear(), date.getMonth(), date.getDate() - mondayOffset(date)));
  const sums = new Map<string, number>();
  for (const s of sessions) {
    if (!s.usage) continue;
    const k = bucketKey(new Date(s.usage.startedAt * 1000));
    sums.set(k, (sums.get(k) ?? 0) + totalTokens(s.usage));
  }
  const n = bucket === "day" ? RANGE_DAYS[range] : RANGE_WEEKS[range];
  const step = bucket === "day" ? 1 : 7;
  const last = d - (bucket === "day" ? 0 : mondayOffset(new Date(y, m, d))); // today, or this week's Monday
  return Array.from({ length: n }, (_, i) => {
    const date = new Date(y, m, last - (n - 1 - i) * step);
    const key = dayKey(date);
    const md = `${date.getMonth() + 1}/${date.getDate()}`;
    if (bucket === "week") return { key, label: md, title: `${key} ~ ${dayKey(new Date(y, m, last - (n - 1 - i) * step + 6))}`, total: sums.get(key) ?? 0 };
    return { key, label: i === 0 || date.getDate() === 1 ? md : String(date.getDate()), title: key, total: sums.get(key) ?? 0 };
  });
}
