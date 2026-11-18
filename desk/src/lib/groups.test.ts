import { expect, test } from "vitest";
import { COMMON_LABEL, displayState, groupSessions, groupSummary, matchSession, moveInOrder, shownSeconds } from "./groups";
import type { Session } from "./types";

const NOW = 1_000_000;
let n = 0;
const mk = (o: Partial<Session> = {}): Session => ({
  agent: "hermes", sessionId: `s${n++}`, cwd: "", repoRoot: null, branch: null,
  state: "idle", since: NOW - 100, turnStart: null, steps: 0,
  tool: "", toolDetail: "", prompt: "", pending: null,
  subagents: [], todos: [], seen: NOW - 10, paneId: null, usage: null, ...o,
});

test("same-named repos get disambiguated labels, key is full path", () => {
  const g = groupSessions([mk({ repoRoot: "D:\\a\\app" }), mk({ repoRoot: "D:\\b\\app" })], NOW);
  expect(g.map((x) => x.label).sort()).toEqual(["app (a)", "app (b)"]);
  expect(g.map((x) => x.path).sort()).toEqual(["D:\\a\\app", "D:\\b\\app"]);
});

test("unique repo name stays plain; same repo shares one group", () => {
  const g = groupSessions([mk({ repoRoot: "D:\\x\\solo" }), mk({ repoRoot: "D:\\x\\solo" })], NOW);
  expect(g).toHaveLength(1);
  expect(g[0].label).toBe("solo");
  expect(g[0].sessions).toHaveLength(2);
});

test("null repoRoot goes to common group", () => {
  const g = groupSessions([mk()], NOW);
  expect(g[0]).toMatchObject({ key: "common", label: COMMON_LABEL, isCommon: true });
});

test("folder without a git repo gets its own group, keyed by cwd", () => {
  const g = groupSessions([mk({ cwd: "D:\\notes\\wiki" }), mk({ cwd: "D:\\notes\\wiki" }), mk({ cwd: "C:\\Users\\me" })], NOW);
  expect(g.map((x) => [x.path, x.label, x.isCommon]).sort()).toEqual([["C:\\Users\\me", "me", false], ["D:\\notes\\wiki", "wiki", false]]);
});

test("one folder spelled differently (slashes, drive case, trailing separator) is one group", () => {
  const g = groupSessions([mk({ cwd: "D:\\ysl\\perch-test" }), mk({ cwd: "d:/ysl/perch-test/" }), mk({ repoRoot: "D:/ysl/perch-test" })], NOW);
  expect(g).toHaveLength(1);
  expect(g[0]).toMatchObject({ label: "perch-test", path: "D:\\ysl\\perch-test" });
  expect(g[0].sessions).toHaveLength(3);
});

test("groups with my-turn sessions come first; inner order by state then since", () => {
  const busy = mk({ repoRoot: "D:\\r\\busy", state: "running" });
  const a = mk({ repoRoot: "D:\\r\\wait", state: "idle", prompt: "x", since: NOW - 50 });
  const b = mk({ repoRoot: "D:\\r\\wait", state: "approval", since: NOW - 40 });
  const c = mk({ repoRoot: "D:\\r\\wait", state: "question", since: NOW - 30 });
  const d = mk({ repoRoot: "D:\\r\\wait", state: "tool", since: NOW - 20 });
  const e = mk({ repoRoot: "D:\\r\\wait", state: "tool", seen: NOW - 700, since: NOW - 900 });
  const f = mk({ repoRoot: "D:\\r\\wait", state: "closed", paneId: "p1" });
  const g1 = mk({ repoRoot: "D:\\r\\wait", state: "idle", prompt: "x", since: NOW - 90 });
  const rd = mk({ repoRoot: "D:\\r\\wait", state: "idle", since: NOW - 10 });
  const g = groupSessions([busy, a, b, c, d, e, f, g1, rd], NOW);
  expect(g[0].label).toBe("wait");
  expect(g[0].sessions).toEqual([b, c, g1, a, d, rd, e, f]);
  expect(g[1].label).toBe("busy");
});

const R = "D:\\r\\sort";
const ids = (g: { sessions: Session[] }) => g.sessions.map((s) => s.sessionId);
const fx = () => {
  const a = mk({ repoRoot: R, title: "banana", seen: NOW - 30, state: "idle", prompt: "x", since: NOW - 10 });
  const b = mk({ repoRoot: R, title: "Apple 10", seen: NOW - 10, state: "approval" });
  const c = mk({ repoRoot: R, title: "apple 2", seen: NOW - 20, state: "idle", prompt: "x", since: NOW - 20 });
  const d = mk({ repoRoot: R, title: "", prompt: "", seen: NOW - 5 });
  return { a, b, c, d, all: [a, b, c, d] };
};

test("sort status (default) is the old order", () => {
  const { a, b, c, d, all } = fx();
  expect(ids(groupSessions(all, NOW)[0])).toEqual([b, c, a, d].map((s) => s.sessionId));
  expect(groupSessions(all, NOW, "status", ["s999"])[0].sessions).toEqual(groupSessions(all, NOW)[0].sessions);
});

test("sort recent: seen descending", () => {
  const { a, b, c, d, all } = fx();
  expect(ids(groupSessions(all, NOW, "recent")[0])).toEqual([d, b, c, a].map((s) => s.sessionId));
});

test("sort name: numeric, case-insensitive, empty last", () => {
  const { a, b, c, d, all } = fx();
  expect(ids(groupSessions(all, NOW, "name")[0])).toEqual([c, b, a, d].map((s) => s.sessionId));
});

test("sort manual: by order index, unknown ids ignored, new sessions after in status order", () => {
  const { a, b, c, d, all } = fx();
  const g = groupSessions(all, NOW, "manual", ["gone", a.sessionId, "gone2", c.sessionId]);
  expect(ids(g[0])).toEqual([a, c, b, d].map((s) => s.sessionId));
  expect(ids(groupSessions(all, NOW, "manual")[0])).toEqual(ids(groupSessions(all, NOW)[0]));
});

test("moveInOrder up, down, no-op, bounds, unknown", () => {
  const v = ["a", "b", "c", "d"];
  expect(moveInOrder(v, "c", 0)).toEqual(["c", "a", "b", "d"]);
  expect(moveInOrder(v, "a", 2)).toEqual(["b", "c", "a", "d"]);
  expect(moveInOrder(v, "b", 1)).toEqual(v);
  expect(moveInOrder(v, "b", -5)).toEqual(["b", "a", "c", "d"]);
  expect(moveInOrder(v, "b", 99)).toEqual(["a", "c", "d", "b"]);
  expect(moveInOrder(v, "zz", 1)).toEqual(v);
  expect(v).toEqual(["a", "b", "c", "d"]);
});

test("displayState: working state with no event for 10+ minutes is stale", () => {
  expect(displayState(mk({ state: "tool", seen: NOW - 601 }), NOW)).toBe("stale");
  expect(displayState(mk({ state: "tool", seen: NOW - 600 }), NOW)).toBe("tool");
  expect(displayState(mk({ state: "idle", seen: NOW - 5000 }), NOW)).toBe("ready");
  expect(displayState(mk({ state: "idle", prompt: "hi" }), NOW)).toBe("done");
});

test("done and ready are not counted as mine", () => {
  const [g] = groupSessions([mk({ prompt: "x" }), mk()], NOW);
  expect(groupSummary(g, NOW)).toEqual({ mine: 0, working: 0 });
});

test("plain sessions are neither mine nor working in groupSummary", () => {
  const [g] = groupSessions([mk({ state: "plain" })], NOW);
  expect(groupSummary(g, NOW)).toEqual({ mine: 0, working: 0 });
});

test("recent: closed or >24h goes to recent, >7d dropped, paneId always stays", () => {
  const closed = mk({ state: "closed" });
  const old = mk({ seen: NOW - 86401 });
  const gone = mk({ seen: NOW - 604801 });
  const pinned = mk({ state: "closed", seen: NOW - 604801, paneId: "p9" });
  const fresh = mk();
  const [g] = groupSessions([closed, old, gone, pinned, fresh], NOW);
  expect(g.sessions).toHaveLength(2);
  expect(g.sessions).toEqual(expect.arrayContaining([pinned, fresh]));
  expect(g.recent).toHaveLength(2);
  expect(g.recent).toEqual(expect.arrayContaining([closed, old]));
});

test("dismissed pane-less session goes to recent, one with a pane stays live", () => {
  const a = mk({ repoRoot: "D:/x/d" }), b = mk({ repoRoot: "D:/x/d" }), c = mk({ repoRoot: "D:/x/d", paneId: "p1" });
  const [g] = groupSessions([a, b, c], NOW, "status", [], new Set([a.sessionId, c.sessionId]));
  expect(g.sessions).toEqual(expect.arrayContaining([b, c]));
  expect(g.sessions).toHaveLength(2);
  expect(g.recent).toEqual([a]);
  expect(groupSessions([a], NOW)[0].sessions).toEqual([a]);
});

test("branch does not affect grouping", () => {
  const g = groupSessions([mk({ repoRoot: "D:\\x\\solo", branch: "main" }), mk({ repoRoot: "D:\\x\\solo", branch: "feature/login" })], NOW);
  expect(g).toHaveLength(1);
  expect(g[0].sessions).toHaveLength(2);
});

test("matchSession searches title, folder and branch only", () => {
  const s = mk({ title: "login fix", prompt: "unrelated words", cwd: "D:/Work/App", branch: "main", tool: "terminal" });
  expect(matchSession(s, "login")).toBe(true);
  expect(matchSession(s, "d:/work")).toBe(true);
  expect(matchSession(s, "login main")).toBe(true);
  expect(matchSession(s, "login zzz")).toBe(false);
  expect(matchSession(s, "terminal")).toBe(false);
  expect(matchSession(s, "unrelated")).toBe(false);
  expect(matchSession(s, "")).toBe(true);
  expect(matchSession(mk({ prompt: "fix login bug" }), "login")).toBe(true);
});

test("shownSeconds: done is frozen at lastTurn, working counts from turnStart, ready/plain blank", () => {
  const d = mk({ state: "idle", prompt: "p", lastTurn: 42 });
  expect([shownSeconds(d, NOW), shownSeconds(d, NOW + 500)]).toEqual([42, 42]);
  expect(shownSeconds(mk({ state: "idle", prompt: "p" }), NOW)).toBeNull();
  expect(shownSeconds(mk({ state: "tool", turnStart: NOW - 30, since: NOW - 5 }), NOW)).toBe(30);
  expect(shownSeconds(mk({ state: "approval", since: NOW - 7 }), NOW)).toBe(7);
  expect(shownSeconds(mk(), NOW)).toBeNull();
  expect(shownSeconds(mk({ state: "closed" }), NOW)).toBeNull();
});
