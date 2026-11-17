import { expect, test } from "vitest";
import { fmtElapsed, stateLabel } from "./format";

test("fmtElapsed", () => {
  expect(fmtElapsed(8)).toBe("8초");
  expect(fmtElapsed(248)).toBe("4분 8초");
  expect(fmtElapsed(3725)).toBe("1시간 2분");
  expect(fmtElapsed(-5)).toBe("0초");
});

test("stateLabel", () => {
  const want = {
    running: "작업중", thinking: "생각중", tool: "실행중", approval: "승인대기",
    question: "질문대기", idle: "답변대기", closed: "종료", stale: "응답 없음",
  } as const;
  for (const [k, v] of Object.entries(want)) expect(stateLabel(k as keyof typeof want)).toBe(v);
});
