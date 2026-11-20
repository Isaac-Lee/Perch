import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { promptHistory } from "../lib/composer";
import { groupItems, useChatSession } from "../lib/chatSession";
import { onChatApprove, onChatStop } from "../lib/backend";
import ChatComposer from "./ChatComposer";
import ChatPrompt from "./ChatPrompt";
import ChatMessage from "./ChatMessage";
import ChatLive from "./ChatLive";
import { setLiveSubagents } from "../lib/liveSubagents";

export default function ChatView({ paneId, cwd, sessionId, focused }: { paneId: string; cwd: string; sessionId: string | null; focused: boolean }) {
  // Session id at first render only (equal to the pane id means none yet); a later paneSetSession must not reconnect.
  const [resumeId] = useState(() => (sessionId && sessionId !== paneId ? sessionId : null));
  const { state, retrying, draft, send, stop, reconnect, attachImage, listModels, setModel, setEffort, completeSlash, answerApproval, answerClarify } = useChatSession(paneId, cwd, resumeId);
  const history = useMemo(() => promptHistory(state.items), [state.items]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const toBottom = () => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; };
  useLayoutEffect(() => { if (stick.current) toBottom(); }, [state.items, state.conn, state.prompts, state.running]);
  // Sidebar buttons arrive as Tauri events; the ref keeps the listeners on the latest state without resubscribing.
  const live = useRef({ state, stop, answerApproval });
  live.current = { state, stop, answerApproval };
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
    return () => { dead = true; offs.forEach((o) => o()); };
  }, [paneId]);
  useEffect(() => { toBottom(); }, [state.sessionId]); // resumed history opens at the bottom
  // Running children go to the sidebar row, keyed by pane id; cleared on unmount.
  useEffect(() => {
    setLiveSubagents(paneId, Object.values(state.subagents).filter((a) => a.status === "starting" || a.status === "running").map((a) => ({ id: a.id, role: "", goal: a.goal, start: (a.startAt ?? Date.now()) / 1000, tool: a.tool || undefined })));
  }, [paneId, state.subagents]);
  useEffect(() => () => setLiveSubagents(paneId, []), [paneId]);
  const down = state.conn === "error" || state.conn === "closed";
  return (
    <div className="chat">
      <div className="chat-scroll" ref={scrollRef} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 40; }}>
        <div className="chat-col">
          {state.items.length === 0 && state.conn === "ready" && <div className="chat-empty">메시지를 입력해 대화를 시작하세요</div>}
          {groupItems(state.items).map((i) => <ChatMessage key={i.id} item={i} subagents={state.subagents} />)}
          {state.running && <ChatLive state={state} />}
          {state.prompts.map((p) => <ChatPrompt key={p.promptId} prompt={p} onApproval={(c) => answerApproval(p.promptId, c)} onClarify={(a) => answerClarify(p.promptId, a)} />)}
          {down && retrying && <div className="chat-status">다시 연결하는 중…</div>}
          {down && !retrying && <div className="chat-status">{state.error ?? "연결이 끊어졌습니다"} <button className="btn" onClick={reconnect}>다시 연결</button></div>}
          {state.conn === "connecting" && <div className="chat-status">연결 중…</div>}
        </div>
      </div>
      <ChatComposer model={state.model ?? undefined} effort={state.effort ?? undefined} draft={draft} history={history} running={state.running} disabled={state.conn !== "ready"} focused={focused} onSend={(t, a) => { stick.current = true; send(t, a); }} onStop={stop} onAttach={attachImage} onListModels={listModels} onSetModel={setModel} onSetEffort={setEffort} onCompleteSlash={completeSlash} />
    </div>
  );
}
