import { expect, test } from "vitest";
import { chartSeries, fmtTokens, summarize, totalTokens } from "./usage";
import type { Session, Usage } from "./types";

const NOW = new Date(2026, 10, 17, 15, 0, 0).getTime() / 1000; // local 2026-11-17 15:00
const DAY = 86400;
const MID = new Date(2026, 10, 17).getTime() / 1000;
let n = 0;
const u = (o: Partial<Usage> = {}): Usage => ({ model: "m", input: 100, output: 50, cacheRead: 10, cacheWrite: 5, reasoning: 20, apiCalls: 2, costUsd: null, startedAt: NOW - 60, ...o });
const mk = (o: Partial<Session> = {}): Session => ({
  agent: "hermes", sessionId: `s${n++}`, cwd: "", repoRoot: null, branch: null, state: "idle", since: 0, turnStart: null, steps: 0,
  tool: "", toolDetail: "", prompt: "", pending: null, subagents: [], todos: [], seen: 0, paneId: null, usage: u(), ...o,
});

test("fmtTokens boundaries", () => {
  expect(fmtTokens(0)).toBe("0");
  expect(fmtTokens(950)).toBe("950");
  expect(fmtTokens(12_400)).toBe("12.4k");
  expect(fmtTokens(2_150_000)).toBe("2.15M");
});

test("totalTokens excludes reasoning", () => {
  expect(totalTokens(u())).toBe(165);
});

test("period filter uses usage.startedAt; today starts at local midnight", () => {
  const s = [mk(), mk({ usage: u({ startedAt: MID - 1 }) }), mk({ usage: u({ startedAt: NOW - 8 * DAY }) }), mk({ usage: u({ startedAt: NOW - 40 * DAY }) })];
  expect(summarize(s, "today", NOW).total.sessions).toBe(1);
  expect(summarize(s, "7d", NOW).total.sessions).toBe(2);
  expect(summarize(s, "30d", NOW).total.sessions).toBe(3);
  expect(summarize(s, "all", NOW).total.sessions).toBe(4);
});

test("cost sums only present values; null when none", () => {
  expect(summarize([mk(), mk()], "all", NOW).total.costUsd).toBeNull();
  expect(summarize([mk(), mk({ usage: u({ costUsd: 0.5 }) }), mk({ usage: u({ costUsd: 0.25 }) })], "all", NOW).total.costUsd).toBe(0.75);
});

test("sessions without usage are excluded", () => {
  const r = summarize([mk({ usage: null }), mk()], "all", NOW);
  expect(r.total.sessions).toBe(1);
  expect(r.bySession).toHaveLength(1);
});

const T = 165; // totalTokens(u())
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).getTime() / 1000;

test("chartSeries point counts per range/bucket", () => {
  const n = (r: "14d" | "30d" | "1y", b: "day" | "week") => chartSeries([], r, b, NOW).length;
  expect([n("14d", "day"), n("30d", "day"), n("1y", "day")]).toEqual([14, 30, 365]);
  expect([n("14d", "week"), n("30d", "week"), n("1y", "week")]).toEqual([2, 5, 53]);
});

test("day series: oldest first, last is today, labels/keys/titles", () => {
  const r = chartSeries([mk(), mk({ usage: u({ startedAt: NOW - 3 * DAY }) })], "14d", "day", NOW);
  expect(r[13]).toEqual({ key: "2026-11-17", label: "17", title: "2026-11-17", total: T });
  expect(r[10].total).toBe(T);
  expect(r[0]).toEqual({ key: "2026-11-04", label: "11/4", title: "2026-11-04", total: 0 });
  const m = chartSeries([], "30d", "day", NOW);
  expect(m.find((p) => p.key === "2026-11-01")!.label).toBe("11/1");
  expect(m.find((p) => p.key === "2026-10-31")!.label).toBe("31");
});

test("week series: Monday start, 1st bucket contains now, title Mon ~ Sun", () => {
  const r = chartSeries([mk()], "1y", "week", NOW);
  expect(r[52]).toEqual({ key: "2026-11-16", label: "11/16", title: "2026-11-16 ~ 2026-11-22", total: T });
  expect(r[0].key).toBe("2025-11-17");
});

test("session at local midnight Monday lands in that week; Sunday 23:59 in the previous", () => {
  const mon = new Date(2026, 10, 16).getTime() / 1000;
  const r = chartSeries([mk({ usage: u({ startedAt: mon }) }), mk({ usage: u({ startedAt: mon - 1 }) })], "1y", "week", NOW);
  expect(r[52].total).toBe(T);
  expect(r[51].total).toBe(T);
});

test("bucket totals equal sum of in-range sessions; null usage ignored; out of range dropped", () => {
  const s = [mk(), mk({ usage: u({ startedAt: NOW - 20 * DAY }) }), mk({ usage: u({ startedAt: NOW - 400 * DAY }) }), mk({ usage: null })];
  const sum = (r: ReturnType<typeof chartSeries>) => r.reduce((a, p) => a + p.total, 0);
  expect(sum(chartSeries(s, "1y", "day", NOW))).toBe(2 * T);
  expect(sum(chartSeries(s, "1y", "week", NOW))).toBe(2 * T);
  expect(sum(chartSeries(s, "30d", "day", NOW))).toBe(2 * T);
  expect(sum(chartSeries(s, "14d", "day", NOW))).toBe(T);
});

test("day stepping is DST-safe", () => {
  // spans US/EU DST changes in most zones; keys must be consecutive calendar days
  const now = at(2026, 2, 30);
  const r = chartSeries([], "1y", "day", now);
  const keys = r.map((p) => p.key);
  expect(new Set(keys).size).toBe(365);
  expect(keys[364]).toBe("2026-03-30");
  expect(keys[0]).toBe("2025-03-31");
  expect(chartSeries([mk({ usage: u({ startedAt: at(2026, 2, 29, 0) }) })], "14d", "day", now).at(-2)!.total).toBe(T);
});

test("lists sorted by total desc; project labels match groups, same-name repos disambiguated", () => {
  const r = summarize([
    mk({ repoRoot: "D:\\a\\app", usage: u({ input: 1 }) }),
    mk({ repoRoot: "D:\\b\\app", usage: u({ input: 1000 }) }),
    mk({ repoRoot: null, usage: u({ input: 500, model: "x" }) }),
  ], "all", NOW);
  expect(r.byProject.map((x) => x.label)).toEqual(["app (b)", "Shared workspace", "app (a)"]);
  expect(r.byModel[0]).toMatchObject({ key: "m", sessions: 2 });
  expect(r.byAgent[0]).toMatchObject({ key: "hermes", sessions: 3 });
});
