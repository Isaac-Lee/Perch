import { useMemo, useState } from "react";
import { X } from "lucide-react";
import type { Session } from "../lib/types";
import { COMMON_LABEL, projectLabels } from "../lib/groups";
import { chartSeries, fmtTokens, summarize, type ChartBucket, type ChartPoint, type ChartRange, type Period, type UsageRow } from "../lib/usage";
import { agentName } from "./SessionRow";

const PERIODS: [Period, string][] = [["today", "오늘"], ["7d", "7일"], ["30d", "30일"], ["all", "전체"]];
const cost = (v: number | null) => (v == null ? "" : `$${v.toFixed(2)}`);
const fmtStart = (t: number) => {
  const d = new Date(t * 1000), p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const RANGES: [ChartRange, string][] = [["14d", "14일"], ["30d", "30일"], ["1y", "1년"]];
const BUCKETS: [ChartBucket, string][] = [["day", "일별"], ["week", "주별"]];
const CHART_KEY = "perch.usageChart";
interface ChartPref { range: ChartRange; bucket: ChartBucket }

function initialChart(): ChartPref {
  let range: ChartRange = "14d", bucket: ChartBucket = "week";
  try {
    const o = JSON.parse(localStorage.getItem(CHART_KEY) ?? "{}");
    if (RANGES.some(([k]) => k === o.range)) range = o.range;
    if (o.bucket === "day" || o.bucket === "week") bucket = o.bucket;
  } catch { /* ignore */ }
  const h = new URLSearchParams(window.location.hash.split("&").slice(1).join("&")); // #usage&chart=1y&bucket=week overrides the stored choice
  const c = h.get("chart"), b = h.get("bucket");
  if (RANGES.some(([k]) => k === c)) range = c as ChartRange;
  if (b === "day" || b === "week") bucket = b;
  return { range, bucket: range === "1y" ? bucket : "day" };
}

// at most ~14 labels: daily 1y -> month starts, weekly 1y -> every 4th week counted from the newest
function showLabel(p: ChartPoint, i: number, n: number, pref: ChartPref): boolean {
  if (n <= 30) return true;
  return pref.bucket === "day" ? p.label.includes("/") && p.key.endsWith("-01") : (n - 1 - i) % 4 === 0;
}

function Chart({ points, pref }: { points: ChartPoint[]; pref: ChartPref }) {
  const max = Math.max(1, ...points.map((d) => d.total));
  const n = points.length;
  const gap = n <= 30 ? 4 : n <= 60 ? 1 : 0;
  return (
    <div className="chart">
      <div className="chart-y"><span>{fmtTokens(max)}</span><span>{fmtTokens(Math.round(max / 2))}</span><span>0</span></div>
      <div className="chart-plot">
        <div className="chart-line" style={{ top: 0 }} />
        <div className="chart-line" style={{ top: "calc(50% - 10px)" }} />
        <div className="chart-line" style={{ bottom: 20 }} />
        <div className="chart-bars" style={{ gap }}>
          {points.map((d) => (
            <div key={d.key} className="chart-col" title={`${d.title} · ${fmtTokens(d.total)} tok`}>
              <div className="chart-bar" style={{ height: `${(d.total / max) * 100}%` }} />
            </div>
          ))}
        </div>
        <div className="chart-x">
          {points.map((d, i) => showLabel(d, i, n, pref) && <span key={d.key} style={{ left: `${((i + 0.5) / n) * 100}%` }}>{d.label}</span>)}
        </div>
      </div>
    </div>
  );
}

function Table({ title, rows, showCost, labelOf }: { title: string; rows: UsageRow[]; showCost: boolean; labelOf?: (r: UsageRow) => string }) {
  return (
    <section className="u-sec">
      <h3>{title}</h3>
      <table className="u-table">
        <thead><tr><th>이름</th><th className="num">세션</th><th className="num">입력</th><th className="num">출력</th><th className="num">캐시</th><th className="num">합계</th>{showCost && <th className="num">비용</th>}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="ellipsis-cell">{labelOf ? labelOf(r) : r.label}</td><td className="num">{r.sessions}</td>
              <td className="num">{fmtTokens(r.input)}</td><td className="num">{fmtTokens(r.output)}</td><td className="num">{fmtTokens(r.cache)}</td>
              <td className="num strong">{fmtTokens(r.total)}</td>{showCost && <td className="num">{cost(r.costUsd)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default function UsageView({ sessions, now, onPick, onClose }: { sessions: Session[]; now: number; onPick: (sessionId: string) => void; onClose: () => void }) {
  const [period, setPeriod] = useState<Period>("7d");
  const [pref, setPref] = useState<ChartPref>(initialChart);
  const pick = (next: ChartPref) => {
    setPref(next);
    try { localStorage.setItem(CHART_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };
  const points = useMemo(() => chartSeries(sessions, pref.range, pref.bucket, now), [sessions, pref, now]);
  const r = useMemo(() => summarize(sessions, period, now), [sessions, period, now]);
  const byId = useMemo(() => new Map(sessions.map((s) => [s.sessionId, s])), [sessions]);
  const labels = useMemo(() => projectLabels(sessions.flatMap((s) => (s.repoRoot ? [s.repoRoot] : []))), [sessions]);
  const t = r.total;
  const showCost = t.costUsd != null;
  const stats: [string, string][] = [
    ["총 토큰", fmtTokens(t.total)], ["입력", fmtTokens(t.input)], ["출력", fmtTokens(t.output)], ["캐시", fmtTokens(t.cache)],
    ["세션", String(t.sessions)], ["API 호출", String(r.apiCalls)], ...(showCost ? [["비용", cost(t.costUsd)] as [string, string]] : []),
  ];
  return (
    <div className="usage">
      <div className="usage-head">
        <span className="usage-title">토큰 사용량</span>
        <div className="seg" role="group" aria-label="기간">
          {PERIODS.map(([k, l]) => <button key={k} className={k === period ? "on" : ""} aria-pressed={k === period} onClick={() => setPeriod(k)}>{l}</button>)}
        </div>
        <span className="grow" />
        <button className="icon-btn" aria-label="사용량 닫기" onClick={onClose}><X size={16} strokeWidth={1.5} /></button>
      </div>
      <div className="usage-body">
        <div className="stats">{stats.map(([k, v]) => <div key={k} className="stat"><span className="stat-k">{k}</span><span className="stat-v">{v}</span></div>)}</div>
        <section className="u-sec">
          <div className="chart-head">
            <h3>토큰 추이</h3>
            <span className="grow" />
            {pref.range === "1y" && (
              <div className="seg" role="group" aria-label="집계 단위">
                {BUCKETS.map(([k, l]) => <button key={k} className={k === pref.bucket ? "on" : ""} aria-pressed={k === pref.bucket} onClick={() => pick({ ...pref, bucket: k })}>{l}</button>)}
              </div>
            )}
            <div className="seg" role="group" aria-label="차트 범위">
              {RANGES.map(([k, l]) => <button key={k} className={k === pref.range ? "on" : ""} aria-pressed={k === pref.range} onClick={() => pick({ range: k, bucket: k === "1y" ? "week" : "day" })}>{l}</button>)}
            </div>
          </div>
          <Chart points={points} pref={pref} />
        </section>
        <Table title="프로젝트별" rows={r.byProject} showCost={showCost} />
        <Table title="모델별" rows={r.byModel} showCost={showCost} />
        <Table title="에이전트별" rows={r.byAgent} showCost={showCost} labelOf={(x) => agentName(x.key as Session["agent"])} />
        <section className="u-sec">
          <h3>세션별</h3>
          <table className="u-table sess">
            <thead><tr><th>에이전트</th><th>프로젝트</th><th>프롬프트</th><th>모델</th><th className="num">입력</th><th className="num">출력</th><th className="num">캐시</th><th className="num">합계</th><th className="num">시작</th></tr></thead>
            <tbody>
              {r.bySession.map((x) => {
                const s = byId.get(x.sessionId)!;
                return (
                  <tr key={x.sessionId} className="click" tabIndex={0} onClick={() => onPick(x.sessionId)} onKeyDown={(e) => { if (e.key === "Enter") onPick(x.sessionId); }}>
                    <td>{agentName(x.agent)}</td>
                    <td className="ellipsis-cell proj">{s.repoRoot ? labels.get(s.repoRoot) : COMMON_LABEL}</td>
                    <td className="ellipsis-cell prompt">{x.label}</td>
                    <td className="ellipsis-cell model">{s.usage!.model}</td>
                    <td className="num">{fmtTokens(x.input)}</td><td className="num">{fmtTokens(x.output)}</td><td className="num">{fmtTokens(x.cache)}</td>
                    <td className="num strong">{fmtTokens(x.total)}</td><td className="num muted">{fmtStart(x.startedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
