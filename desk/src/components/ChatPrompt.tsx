import { useState } from "react";
import type { ChatPrompt as Prompt } from "../lib/chatSession";
import { enterAction } from "../lib/composer";

const LABEL: Record<string, string> = { once: "한 번 허용", session: "이 세션 동안 허용", always: "항상 허용", deny: "거부" };

/** "Label — detail" / "Label: detail" / "Label - detail" → [label, detail]; no separator → whole text is the label. */
export function splitChoice(c: string): [string, string] {
  const m = c.match(/^(.{1,60}?)\s*(?:\s[—–-]\s|:\s|\n)\s*([\s\S]+)$/);
  return m ? [m[1].trim(), m[2].trim()] : [c.trim(), ""];
}

export default function ChatPrompt({ prompt, onApproval, onClarify }: { prompt: Prompt; onApproval: (choice: string) => void; onClarify: (answer: string) => void }) {
  const [sent, setSent] = useState(false); // one answer per prompt; the card disappears when settled
  const [text, setText] = useState("");
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
            <button key={c} className="chat-prompt-option" disabled={sent} onClick={() => answer(() => onClarify(c))}>
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
        <button className="btn" disabled={sent} onClick={() => answer(() => onClarify(""))}>건너뛰기</button>
      </div>
    </div>
  );
}
