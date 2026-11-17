import { expect, test } from "vitest";
import { clampSidebarWidth } from "./uiSettings";
import { groupSummary } from "./groups";
import type { Group, Session } from "./types";

test("clampSidebarWidth keeps 200..480", () => {
  expect(clampSidebarWidth(100)).toBe(200);
  expect(clampSidebarWidth(300)).toBe(300);
  expect(clampSidebarWidth(900)).toBe(480);
  expect(clampSidebarWidth(NaN)).toBe(260);
});

test("groupSummary counts my-turn and working sessions", () => {
  const mk = (state: Session["state"], seen = 1000) => ({ state, seen } as Session);
  const g = { sessions: [mk("approval"), mk("idle"), mk("tool"), mk("thinking"), mk("tool", 0), mk("closed")] } as Group;
  expect(groupSummary(g, 1000)).toEqual({ mine: 2, working: 2 });
});
