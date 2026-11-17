import { useMemo, useState } from "react";
import { X } from "lucide-react";
import type { Session } from "../lib/types";
import { COMMON_LABEL, projectLabels } from "../lib/groups";
import { fmtTokens, summarize, type Period, type UsageRow } from "../lib/usage";
import { agentName } from "./SessionRow";

const PERIODS: [Period, string][] = [["today", "오늘"], ["7d", "7일"], ["30d", "30일"], ["all", "전체"]];
const cost = (v: number | null) => (v == null ? "" : `$${v.toFixed(2)}`);
const fmtStart = (t: number) => {
  const d = new Date(t * 1000), p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

function Chart({ days }: { days: { day: string; total: number }[] }) {
  const max = Math.max(1, ...days.map((d) => d.total));
  return (
    <div className="chart">
      <div className="chart-y"><span>{fmtTokens(max)}</span><span>{fmtTokens(Math.round(max / 2))}</span><span>0</span></div>
      <div className="chart-plot">
        <div className="chart-line" style={{ top: 0 }} />
        <div className="chart-line" style={{ top: "calc(50% - 10px)" }} />
        <div className="chart-line" style={{ bottom: 20 }} />
        <div className="chart-bars">
          {days.map((d) => (
            <div key={d.day} className="chart-col" title={`${d.day}  ${fmtTokens(d.total)} tok`}>
              <div className="chart-bar" style={{ height: `${(d.total / max) * 100}%` }} />
            </div>
          ))}
        </div>
        <div className="chart-x">
          {days.map((d, i) => <span key={d.day}>{i === 0 || d.day.endsWith("-01") ? `${+d.day.slice(5, 7)}/${+d.day.slice(8)}` : +d.day.slice(8)}</span>)}
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
        <section className="u-sec"><h3>일별 토큰 · 최근 14일</h3><Chart days={r.byDay} /></section>
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
