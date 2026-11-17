import { expect, test } from "vitest";
import { fmtTokens, summarize, totalTokens } from "./usage";
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

test("byDay has 14 local days ending today, empty days are 0", () => {
  const r = summarize([mk(), mk({ usage: u({ startedAt: NOW - 3 * DAY }) })], "all", NOW);
  expect(r.byDay).toHaveLength(14);
  expect(r.byDay[13]).toEqual({ day: "2026-11-17", total: 165 });
  expect(r.byDay[10]).toEqual({ day: "2026-11-14", total: 165 });
  expect(r.byDay[0]).toEqual({ day: "2026-11-04", total: 0 });
});

test("lists sorted by total desc; project labels match groups, same-name repos disambiguated", () => {
  const r = summarize([
    mk({ repoRoot: "D:\\a\\app", usage: u({ input: 1 }) }),
    mk({ repoRoot: "D:\\b\\app", usage: u({ input: 1000 }) }),
    mk({ repoRoot: null, usage: u({ input: 500, model: "x" }) }),
  ], "all", NOW);
  expect(r.byProject.map((x) => x.label)).toEqual(["app (b)", "공통 작업 공간", "app (a)"]);
  expect(r.byModel[0]).toMatchObject({ key: "m", sessions: 2 });
  expect(r.byAgent[0]).toMatchObject({ key: "hermes", sessions: 3 });
});
