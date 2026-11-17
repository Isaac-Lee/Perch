import { useEffect, useRef, useState } from "react";
import { Bot, Folder, Plus, SquareTerminal, Terminal } from "lucide-react";
import type { AgentKind } from "../lib/types";
import { attachScrollReveal } from "../lib/useScrollReveal";
import { folderName, recentFolders } from "../mock/sessions";

const AGENTS: [AgentKind, string, typeof Bot][] = [["hermes", "Hermes", Bot], ["opencode", "OpenCode", SquareTerminal], ["shell", "셸", Terminal]];

export default function NewPaneMenu({ onAdd }: { onAdd: (agent: AgentKind, cwd: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const pick = (a: AgentKind, cwd: string) => { onAdd(a, cwd); setOpen(false); };
  return (
    <div className="menu-wrap" ref={ref}>
      <button className="icon-btn" aria-label="새 칸" aria-expanded={open} onClick={() => setOpen(!open)}><Plus size={16} strokeWidth={1.5} /></button>
      {open && (
        <div className="menu" ref={(el) => { if (el) attachScrollReveal(el); }}>
          <div className="menu-label">에이전트</div>
          {AGENTS.map(([a, name, Icon]) => (
            <button key={a} className="menu-item" onClick={() => pick(a, recentFolders[0])}><Icon size={16} strokeWidth={1.5} />{name}</button>
          ))}
          <div className="menu-label">최근 폴더</div>
          {recentFolders.map((f) => (
            <button key={f} className="menu-item" title={f} onClick={() => pick("hermes", f)}><Folder size={16} strokeWidth={1.5} /><span className="ellipsis">{folderName(f)}</span></button>
          ))}
        </div>
      )}
    </div>
  );
}
