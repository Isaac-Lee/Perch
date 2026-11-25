import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { promptHistory } from "../lib/composer";
import { groupItems, useChatSession, userActions } from "../lib/chatSession";
import { onChatApprove, onChatFork, onChatStop } from "../lib/backend";
import ChatComposer from "./ChatComposer";
import ChatPrompt from "./ChatPrompt";
import ChatMessage, { type ChatActions } from "./ChatMessage";
import type { Session } from "../lib/types";
import ChatLive from "./ChatLive";
import ChatQueue from "./ChatQueue";
import { setLiveSubagents } from "../lib/liveSubagents";
import { setBackgroundTasks } from "../lib/liveBackground";
import { setPaneGraph } from "../lib/paneGraph";

export default function ChatView({ paneId, cwd, sessionId, focused, session }: { paneId: string; cwd: string; sessionId: string | null; focused: boolean; session?: Session }) {
  // Session id at first render only (equal to the pane id means none yet); a later paneSetSession must not reconnect.
  const [resumeId] = useState(() => (sessionId && sessionId !== paneId ? sessionId : null));
  const { state, retrying, draft, send, stop, reconnect, attachImage, listModels, setModel, setEffort, completeSlash, sendNow, answerApproval, answerClarify, rewindTo, overwrite, fork, forkEnd } = useChatSession(paneId, cwd, resumeId);
  const [extra, setExtra] = useState<string[]>([]); // drafts a rewind replaced, newest first, recallable with up-arrow
  const history = useMemo(() => [...extra, ...promptHistory(state.items)], [extra, state.items]);
  // Per-bubble actions for user items. The hook's actions read live state through its own ref, so a closure from an earlier render is safe.
  const actions = useMemo(() => {
    const m = new Map<string, ChatActions>();
    for (const item of state.items) {
      if (item.kind !== "user") continue;
      m.set(item.id, {
        state: userActions(state, item),
        onRewind: () => { void rewindTo(item, item.text); },
        onOverwrite: (t, a) => { void overwrite(item, t, a); },
        onFork: (t, now, a) => { void fork(item, t, now, a); },
        onAttach: attachImage,
      });
    }
    return m;
  }, [state.items, state.running, state.queued, state.rowIds]); // eslint-disable-line react-hooks/exhaustive-deps
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const toBottom = () => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; };
  useLayoutEffect(() => { if (stick.current) toBottom(); }, [state.items, state.conn, state.prompts, state.running]);
  // Sidebar buttons arrive as Tauri events; the ref keeps the listeners on the latest state without resubscribing.
  const live = useRef({ state, stop, forkEnd, answerApproval });
  live.current = { state, stop, forkEnd, answerApproval };
  useEffect(() => {
    let dead = false;
    const offs: (() => void)[] = [];
    const keep = (p: Promise<() => void>) => p.then((off) => (dead ? off() : offs.push(off)), console.error);
    keep(onChatApprove((p) => {
      if (p.paneId !== paneId) return;
      const { state: st, answerApproval: answer } = live.current;
      const pr = st.prompts.find((x) => x.kind === "approval");
      if (!pr || !pr.choices.length) return;
      const want = p.allow ? "once" : "deny";
      answer(pr.promptId, pr.choices.includes(want) ? want : p.allow ? pr.choices[0] : pr.choices[pr.choices.length - 1]);
    }));
    keep(onChatStop((p) => { if (p.paneId === paneId) live.current.stop(); }));
    keep(onChatFork((p) => { if (p.paneId === paneId) void live.current.forkEnd(); }));
    return () => { dead = true; offs.forEach((o) => o()); };
  }, [paneId]);
  useEffect(() => { toBottom(); }, [state.sessionId]); // resumed history opens at the bottom
  // Running children go to the sidebar row, keyed by pane id; cleared on unmount.
  useEffect(() => {
    setLiveSubagents(paneId, Object.values(state.subagents).filter((a) => a.status === "starting" || a.status === "running").map((a) => ({ id: a.id, role: "", goal: a.goal, start: (a.startAt ?? Date.now()) / 1000, tool: a.tool || undefined })));
  }, [paneId, state.subagents]);
  useEffect(() => () => setLiveSubagents(paneId, []), [paneId]);
  useEffect(() => {
    setBackgroundTasks(paneId, state.items.flatMap((i) => (i.kind === "background" ? [i.taskId] : [])));
  }, [paneId, state.items]);
  useEffect(() => () => setBackgroundTasks(paneId, []), [paneId]);
  useEffect(() => {
    setPaneGraph(paneId, { subagents: Object.values(state.subagents), background: state.items.flatMap((i) => (i.kind === "background" ? [{ taskId: i.taskId, text: i.text, status: i.status, startedAt: i.startedAt, durationS: i.durationS }] : [])) });
  }, [paneId, state.subagents, state.items]);
  useEffect(() => () => setPaneGraph(paneId, { subagents: [], background: [] }), [paneId]);
  const grouped = useMemo(() => groupItems(state.items), [state.items]);
  const down = state.conn === "error" || state.conn === "closed";
  return (
    <div className="chat">
      <div className="chat-scroll" ref={scrollRef} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 40; }}>
        <div className="chat-col">
          {state.items.length === 0 && state.conn === "ready" && <div className="chat-empty">메시지를 입력해 대화를 시작하세요</div>}
          {/* user rows keyed by their Hermes row: a re-indexed transcript (or a newly saved row) remounts the bubble, so an open editor never binds to another message */}
          {grouped.map((i) => <ChatMessage key={i.kind === "user" && i.rowId !== undefined ? `row${i.rowId}` : i.id} item={i} subagents={state.subagents} actions={actions.get(i.id)} />)}
          {state.running && <ChatLive state={state} session={session} />}
          {state.prompts.map((p) => <ChatPrompt key={p.promptId} prompt={p} onApproval={(c) => answerApproval(p.promptId, c)} onClarify={(a) => answerClarify(p.promptId, a)} />)}
          {down && retrying && <div className="chat-status">다시 연결하는 중…</div>}
          {down && !retrying && <div className="chat-status">{state.error ?? "연결이 끊어졌습니다"} <button className="btn" onClick={reconnect}>다시 연결</button></div>}
          {state.conn === "connecting" && <div className="chat-status">연결 중…</div>}
        </div>
      </div>
      {state.queued.length > 0 && <ChatQueue queued={state.queued} onSendNow={sendNow} />}
      <ChatComposer model={state.model ?? undefined} effort={state.effort ?? undefined} draft={draft} onDraftReplaced={(old) => setExtra((e) => [old, ...e])} history={history} running={state.running} disabled={state.conn !== "ready"} focused={focused} onSend={(t, a) => { stick.current = true; send(t, a); }} onStop={stop} onAttach={attachImage} onListModels={listModels} onSetModel={setModel} onSetEffort={setEffort} onCompleteSlash={completeSlash} />
    </div>
  );
}
