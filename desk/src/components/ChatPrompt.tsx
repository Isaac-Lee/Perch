import { useState } from "react";
import type { ChatPrompt as Prompt } from "../lib/chatSession";
import { enterAction } from "../lib/composer";
import { splitChoice, stripRecommended } from "../lib/choice";

const LABEL: Record<string, string> = { once: "한 번 허용", session: "이 세션 동안 허용", always: "항상 허용", deny: "거부" };

export default function ChatPrompt({ prompt, onApproval, onClarify }: { prompt: Prompt; onApproval: (choice: string) => void; onClarify: (answer: string) => void }) {
  const [sent, setSent] = useState(false); // one answer per prompt; the card disappears when settled
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const answer = (fn: () => void) => { if (!sent) { setSent(true); fn(); } };

  if (prompt.kind === "approval") {
    const firstAllow = prompt.choices.find((c) => c !== "deny");
    return (
      <div className="chat-prompt">
        <div className="chat-prompt-title">승인 필요</div>
        {prompt.description && <div className="chat-prompt-text">{prompt.description}</div>}
        {prompt.command && <pre className="chat-tool-result">{prompt.command}</pre>}
        <div className="chat-prompt-actions">
          {prompt.choices.map((c) => (
            <button key={c} className={c === firstAllow ? "btn primary" : c === "deny" ? "btn danger" : "btn"} disabled={sent} onClick={() => answer(() => onApproval(c))}>{LABEL[c] ?? c}</button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="chat-prompt">
      <div className="chat-prompt-title">질문</div>
      {prompt.questions ? prompt.questions.map((q, i) => <div key={i} className="chat-prompt-text">{q}</div>) : <div className="chat-prompt-text">{prompt.question}</div>}
      {prompt.choices.length > 0 && (
        <div className="chat-prompt-options">
          {prompt.choices.map((c, i) => { const [label, detail] = splitChoice(c); return (
            <button key={c} className="chat-prompt-option" disabled={sent} aria-pressed={prompt.multiSelect ? picked.includes(c) : undefined} style={prompt.multiSelect && picked.includes(c) ? { borderColor: "var(--accent)" } : undefined} onClick={() => (prompt.multiSelect ? setPicked((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c])) : answer(() => onClarify(c)))}>
              <span className="chat-prompt-option-label">{i + 1}. {label}</span>
              {detail && <span className="chat-prompt-option-detail">{detail}</span>}
            </button>
          ); })}
        </div>
      )}
      <div className="chat-prompt-actions">
        <input
          className="chat-prompt-input" value={text} disabled={sent} placeholder="직접 입력 — Enter로 답하기"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (enterAction({ key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode }) === "send" && text.trim()) { e.preventDefault(); answer(() => onClarify(text.trim())); }
          }}
        />
        {prompt.multiSelect && <button className="btn primary" disabled={sent || !picked.length} onClick={() => answer(() => onClarify(JSON.stringify(picked.map((c) => stripRecommended(c)))))}>보내기</button>}
        <button className="btn" disabled={sent} onClick={() => answer(() => onClarify(""))}>건너뛰기</button>
      </div>
    </div>
  );
}
