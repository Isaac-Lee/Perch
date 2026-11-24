import { expect, test, vi } from "vitest";
import { clampSidebarWidth, loadNewPane, loadPaneLayout, savePaneLayout, loadTheme, saveTheme, loadDismissed, saveDismissed, loadSessionOrder, loadSessionSort, pushRecent, removeRecent, loadRecentFolders, saveSessionOrder, saveSessionSort, loadGroupBy, saveGroupBy, loadReadAt, saveReadAt, markRead, MAX_ORDER, loadOpenPanes, saveOpenPanes, subscribeStored, saveArchived, loadArchived } from "./uiSettings";

test("pushRecent moves to front, dedupes, caps at 8", () => {
  expect(pushRecent(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
  const nine = "abcdefghi".split("");
  const r = pushRecent(nine, "z");
  expect(r).toHaveLength(8);
  expect(r[0]).toBe("z");
  expect(r.at(-1)).toBe("g");
});
import { groupSummary } from "./groups";
import type { Group, Session } from "./types";

test("clampSidebarWidth keeps 200..480", () => {
  expect(clampSidebarWidth(100)).toBe(200);
  expect(clampSidebarWidth(300)).toBe(300);
  expect(clampSidebarWidth(900)).toBe(480);
  expect(clampSidebarWidth(NaN)).toBe(320);
});

test("groupSummary counts my-turn and working sessions", () => {
  const mk = (state: Session["state"], seen = 1000) => ({ state, seen } as Session);
  const g = { sessions: [mk("approval"), mk("idle"), mk("tool"), mk("thinking"), mk("tool", 0), mk("closed")] } as Group;
  expect(groupSummary(g, 1000)).toEqual({ mine: 1, working: 2, unread: 0 });
});

test("session sort/order load validates stored values", () => {
  const store: Record<string, string> = {};
  vi.stubGlobal("localStorage", { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } });
  expect(loadSessionSort()).toBe("status");
  expect(loadSessionOrder()).toEqual([]);
  saveSessionSort("name");
  expect(loadSessionSort()).toBe("name");
  store["perch.sessionSort"] = JSON.stringify("bogus");
  expect(loadSessionSort()).toBe("status");
  store["perch.sessionSort"] = "{not json";
  expect(loadSessionSort()).toBe("status");
  store["perch.sessionOrder"] = JSON.stringify("nope");
  expect(loadSessionOrder()).toEqual([]);
  store["perch.sessionOrder"] = JSON.stringify(["a", 3, null, "b"]);
  expect(loadSessionOrder()).toEqual(["a", "b"]);
  saveSessionOrder(Array.from({ length: 500 }, (_, i) => `s${i}`));
  expect(loadSessionOrder()).toHaveLength(300);
  vi.unstubAllGlobals();
});

test("dismissed sessions load validates and caps, keeping the newest", () => {
  const store: Record<string, string> = {};
  vi.stubGlobal("localStorage", { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } });
  expect(loadDismissed()).toEqual([]);
  store["perch.dismissedSessions"] = JSON.stringify(["a", 1, "b"]);
  expect(loadDismissed()).toEqual(["a", "b"]);
  store["perch.dismissedSessions"] = "{}";
  expect(loadDismissed()).toEqual([]);
  saveDismissed(Array.from({ length: 400 }, (_, i) => `s${i}`));
  expect(loadDismissed()).toHaveLength(300);
  expect(loadDismissed().at(-1)).toBe("s399");
  vi.unstubAllGlobals();
});

test("theme load validates, defaults to dark", () => {
  const store: Record<string, string> = {};
  vi.stubGlobal("localStorage", { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } });
  expect(loadTheme()).toBe("dark");
  saveTheme("light");
  expect(loadTheme()).toBe("light");
  for (const bad of ['"neon"', "3", "{not json", "null"]) { store["perch.theme"] = bad; expect(loadTheme()).toBe("dark"); }
  vi.unstubAllGlobals();
});

test("loadPaneLayout validates stored layout", () => {
  const store: Record<string, string> = {};
  vi.stubGlobal("localStorage", { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } });
  expect(loadPaneLayout()).toEqual([]);
  savePaneLayout([["a"], ["b", "c"]]);
  expect(loadPaneLayout()).toEqual([["a"], ["b", "c"]]);
  for (const bad of ['"x"', "[1]", '[["a"],[]]', '[["a",2]]', "{}"]) { store["perch.paneLayout.main"] = bad; expect(loadPaneLayout()).toEqual([]); }
  vi.unstubAllGlobals();
});

test("loadNewPane view: tui only when saved exactly as tui", () => {
  const store: Record<string, string> = {};
  vi.stubGlobal("localStorage", { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } });
  expect(loadNewPane("/f").view).toBe("chat");
  store["perch.newPane"] = JSON.stringify({ agent: "hermes" });
  expect(loadNewPane("/f").view).toBe("chat");
  store["perch.newPane"] = JSON.stringify({ agent: "hermes", view: "tui" });
  expect(loadNewPane("/f").view).toBe("tui");
  store["perch.newPane"] = JSON.stringify({ agent: "hermes", view: "x" });
  expect(loadNewPane("/f").view).toBe("chat");
  vi.unstubAllGlobals();
});

test("recent folders dedupe spelling variants, remove, and clean on load", () => {
  expect(pushRecent(["D:\\a\\b", "x"], "d:/a/b/")).toEqual(["d:/a/b/", "x"]);
  expect(removeRecent(["D:\\a\\b", "x"], "d:/a/b")).toEqual(["x"]);
  const store: Record<string, string> = {};
  vi.stubGlobal("localStorage", { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } });
  store["perch.recentFolders"] = JSON.stringify(["D:\\a\\b", "d:/a/b/", "C:\\", "c:/"]);
  expect(loadRecentFolders([])).toEqual(["D:\\a\\b", "C:\\"]);
  vi.unstubAllGlobals();
});

test("readAt round-trips, rejects broken values, caps keeping the newest", () => {
  const store: Record<string, string> = {};
  vi.stubGlobal("localStorage", { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } });
  expect(loadReadAt()).toEqual({});
  saveReadAt({ a: 5, b: 9 });
  expect(loadReadAt()).toEqual({ a: 5, b: 9 });
  for (const bad of ["{not json", "[1,2]", '"x"', "null", "3"]) { store["perch.readAt"] = bad; expect(loadReadAt()).toEqual({}); }
  store["perch.readAt"] = JSON.stringify({ a: 1, b: "2", c: null, d: 4 });
  expect(loadReadAt()).toEqual({ a: 1, d: 4 });
  saveReadAt(Object.fromEntries(Array.from({ length: MAX_ORDER + 50 }, (_, i) => [`s${i}`, i])));
  const m = loadReadAt();
  expect(Object.keys(m)).toHaveLength(MAX_ORDER);
  expect(m[`s${MAX_ORDER + 49}`]).toBe(MAX_ORDER + 49);
  expect(m.s0).toBeUndefined();
  expect(markRead({ a: 1 }, "b", 2)).toEqual({ a: 1, b: 2 });
  vi.unstubAllGlobals();
});

test("group-by load validates, defaults to folder", () => {
  const store: Record<string, string> = {};
  vi.stubGlobal("localStorage", { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } });
  expect(loadGroupBy()).toBe("folder");
  saveGroupBy("status");
  expect(loadGroupBy()).toBe("status");
  for (const bad of ['"bogus"', "3", "{not json", "null"]) { store["perch.sessionGroupBy"] = bad; expect(loadGroupBy()).toBe("folder"); }
  vi.unstubAllGlobals();
});

test("recent folders drop empty entries and fall back to a non-empty seed", () => {
  const store: Record<string, string> = {};
  vi.stubGlobal("localStorage", { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } });
  expect(loadRecentFolders(["/home/u"])).toEqual(["/home/u"]);
  expect(loadRecentFolders([""])).toEqual([]);
  store["perch.recentFolders"] = '["", "/a"]';
  expect(loadRecentFolders(["/home/u"])).toEqual(["/a"]);
  store["perch.recentFolders"] = '[""]';
  expect(loadRecentFolders(["/home/u"])).toEqual(["/home/u"]);
  vi.unstubAllGlobals();
});

test("open panes round-trip and bad entries are dropped", () => {
  const store: Record<string, string> = {};
  vi.stubGlobal("localStorage", { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } });
  expect(loadOpenPanes()).toEqual([]);
  saveOpenPanes([{ agent: "hermes", cwd: "/a", view: "chat", sessionId: "s1" }, { agent: "shell", cwd: "/b", view: "tui", sessionId: null }]);
  expect(loadOpenPanes()).toHaveLength(2);
  store["perch.openPanes"] = '[{"agent":"x","cwd":"/a"},{"agent":"shell","cwd":""},null,{"agent":"shell","cwd":"/c","view":"bogus","sessionId":3}]';
  expect(loadOpenPanes()).toEqual([{ agent: "shell", cwd: "/c", view: "tui", sessionId: null }]);
  store["perch.openPanes"] = "{}";
  expect(loadOpenPanes()).toEqual([]);
  vi.unstubAllGlobals();
});

test("writes notify subscribers and building on the stored value merges", () => {
  const store: Record<string, string> = {};
  vi.stubGlobal("localStorage", { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } });
  const f = vi.fn();
  const off = subscribeStored(f);
  saveArchived(["a"]);
  expect(f).toHaveBeenCalledTimes(1);
  store["perch.archivedSessions"] = '["a","b"]'; // another window archived "b"
  saveArchived([...loadArchived(), "c"]);
  expect(loadArchived()).toEqual(["a", "b", "c"]);
  off();
  vi.unstubAllGlobals();
});
