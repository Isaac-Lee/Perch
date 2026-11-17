import type { AgentKind, Session, Usage } from "./types";
import { COMMON_LABEL, projectLabels } from "./groups";

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

  const total = blank("total", "합계");
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

  const perDay = new Map<string, number>();
  for (const s of withUsage) { const k = dayKey(new Date(s.usage.startedAt * 1000)); perDay.set(k, (perDay.get(k) ?? 0) + totalTokens(s.usage)); }
  const today = new Date(now * 1000);
  const byDay = Array.from({ length: 14 }, (_, i) => {
    const day = dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - (13 - i)));
    return { day, total: perDay.get(day) ?? 0 };
  });

  return {
    total, apiCalls,
    byProject: [...groups.project.values()].sort(desc),
    byModel: [...groups.model.values()].sort(desc),
    byAgent: [...groups.agent.values()].sort(desc),
    bySession: bySession.sort(desc),
    byDay,
  };
}
