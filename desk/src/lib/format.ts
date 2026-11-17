import type { SessionStateName } from "./types";

export function fmtElapsed(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return `${s}초`;
  if (s < 3600) return `${Math.floor(s / 60)}분 ${s % 60}초`;
  return `${Math.floor(s / 3600)}시간 ${Math.floor((s % 3600) / 60)}분`;
}

const LABELS: Record<SessionStateName | "stale", string> = {
  running: "작업중", thinking: "생각중", tool: "실행중", approval: "승인대기",
  question: "질문대기", idle: "답변대기", closed: "종료", stale: "응답 없음",
};

export function stateLabel(s: SessionStateName | "stale"): string {
  return LABELS[s];
}
