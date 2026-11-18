import { expect, test, vi } from "vitest";
import { clampSidebarWidth, loadNewPane, loadPaneLayout, savePaneLayout, loadTheme, saveTheme, loadDismissed, saveDismissed, loadSessionOrder, loadSessionSort, pushRecent, saveSessionOrder, saveSessionSort } from "./uiSettings";

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
  expect(groupSummary(g, 1000)).toEqual({ mine: 1, working: 2 });
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
  for (const bad of ['"x"', "[1]", '[["a"],[]]', '[["a",2]]', "{}"]) { store["perch.paneLayout"] = bad; expect(loadPaneLayout()).toEqual([]); }
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
