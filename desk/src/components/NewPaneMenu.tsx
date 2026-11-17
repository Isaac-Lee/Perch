import { useEffect, useRef, useState } from "react";
import { Bot, ChevronDown, Folder, Plus, SquareTerminal, Terminal } from "lucide-react";
import type { AgentKind } from "../lib/types";
import { attachScrollReveal } from "../lib/useScrollReveal";
import { folderName, recentFolders } from "../mock/sessions";

const AGENTS: [AgentKind, string, typeof Bot][] = [["hermes", "Hermes", Bot], ["opencode", "OpenCode", SquareTerminal], ["shell", "Shell", Terminal]];

export default function NewPaneMenu({ onAdd, defaults }: { onAdd: (agent: AgentKind, cwd: string) => void; defaults: { agent: AgentKind; cwd: string } }) {
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
      <div className="split">
        <button className="icon-btn" aria-label="New session" title={`${defaults.agent} · ${folderName(defaults.cwd)}`} onClick={() => onAdd(defaults.agent, defaults.cwd)}><Plus size={16} strokeWidth={1.5} /></button>
        <button className="icon-btn" aria-label="New session options" aria-expanded={open} onClick={() => setOpen(!open)}><ChevronDown size={16} strokeWidth={1.5} /></button>
      </div>
      {open && (
        <div className="menu" ref={(el) => { if (el) attachScrollReveal(el); }}>
          <div className="menu-label">Agent</div>
          {AGENTS.map(([a, name, Icon]) => (
            <button key={a} className="menu-item" onClick={() => pick(a, recentFolders[0])}><Icon size={16} strokeWidth={1.5} />{name}</button>
          ))}
          <div className="menu-label">Recent folders</div>
          {recentFolders.map((f) => (
            <button key={f} className="menu-item" title={f} onClick={() => pick("hermes", f)}><Folder size={16} strokeWidth={1.5} /><span className="ellipsis">{folderName(f)}</span></button>
          ))}
        </div>
      )}
    </div>
  );
}
