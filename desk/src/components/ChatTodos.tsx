import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Todo } from "../lib/types";
import { TODO_ICON } from "./SessionRow";

/** Hermes's task list, docked above the composer. */
export default function ChatTodos({ todos }: { todos: Todo[] }) {
  const [open, setOpen] = useState(true);
  const Chev = open ? ChevronDown : ChevronRight;
  return (
    <div className="chat-todos"><div className="chat-todos-card">
      <button className="chat-todos-head" aria-expanded={open} onClick={() => setOpen(!open)}><Chev size={14} strokeWidth={1.5} />Tasks {todos.filter((t) => t.status === "done").length}/{todos.length}</button>
      {open && <div className="chat-todos-body">{todos.map((t, i) => {
        const Icon = TODO_ICON[t.status];
        return <div key={i} className={`row-line todo ${t.status}`}><Icon size={16} strokeWidth={1.5} /><span className="ellipsis" title={t.text}>{t.text}</span></div>;
      })}</div>}
    </div></div>
  );
}
