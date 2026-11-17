import { useEffect, useRef, useState } from "react";
import { Bot, Check, ChevronDown, Folder, FolderOpen, Plus, SquareTerminal, Terminal } from "lucide-react";
import type { AgentKind } from "../lib/types";
import type { NewPaneDefaults } from "../lib/uiSettings";
import { attachScrollReveal } from "../lib/useScrollReveal";
import { isTauri, pickFolder } from "../lib/backend";
import { folderName } from "../mock/sessions";
import { formatShortcut } from "../lib/shortcuts";

const AGENTS: [AgentKind, string, typeof Bot][] = [["hermes", "Hermes", Bot], ["opencode", "OpenCode", SquareTerminal], ["shell", "Shell", Terminal]];
const agentIcon = (a: AgentKind) => AGENTS.find(([k]) => k === a)![2];
const agentName = (a: AgentKind) => AGENTS.find(([k]) => k === a)![1];

export default function NewPaneMenu({ defaults, folders, onAdd, onDefaults, onChooseFolder, variant = "bar" }: {
  variant?: "bar" | "side"; defaults: NewPaneDefaults; folders: string[];
  onAdd: (agent: AgentKind, cwd: string) => void; onDefaults: (v: NewPaneDefaults) => void; onChooseFolder: (cwd: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const list = folders.includes(defaults.cwd) ? folders : [defaults.cwd, ...folders];
  const choose = async () => {
    const p = await pickFolder();
    if (p) onChooseFolder(p);
    else if (p === null && !isTauri) setTyping(true);
  };
  const AgentIcon = agentIcon(defaults.agent);
  return (
    <div className={`menu-wrap ns ns-${variant}`} ref={ref}>
      <button className="ns-open" title={`New session · ${formatShortcut("new")}`} onClick={() => onAdd(defaults.agent, defaults.cwd)}>
        <Plus size={16} strokeWidth={1.5} /><span>New session</span>
      </button>
      <button className="ns-target" aria-label="New session target" aria-expanded={open} title={defaults.cwd} onClick={() => setOpen(!open)}>
        <AgentIcon size={14} strokeWidth={1.5} /><span className="ellipsis">{agentName(defaults.agent)} · {folderName(defaults.cwd)}</span><ChevronDown size={14} strokeWidth={1.5} />
      </button>
      {open && (
        <div className="menu env-menu" ref={(el) => { if (el) attachScrollReveal(el); }}>
          <div className="menu-label">Folder</div>
          {list.map((f) => (
            <button key={f} className="menu-item" role="menuitemradio" aria-checked={f === defaults.cwd} title={f} onClick={() => onDefaults({ ...defaults, cwd: f })}>
              <Folder size={16} strokeWidth={1.5} /><span className="ellipsis">{folderName(f)}</span>{f === defaults.cwd && <Check className="check" size={16} strokeWidth={1.5} />}
            </button>
          ))}
          {typing ? (
            <input className="field" placeholder="Folder path" aria-label="Folder path" autoFocus
              onKeyDown={(e) => {
                if (e.key === "Escape") setTyping(false);
                else if (e.key === "Enter" && e.currentTarget.value.trim()) { onChooseFolder(e.currentTarget.value.trim()); setTyping(false); }
              }} />
          ) : (
            <button className="menu-item" onClick={choose}><FolderOpen size={16} strokeWidth={1.5} />Choose folder…</button>
          )}
          <div className="menu-sep" />
          <div className="menu-label">Agent</div>
          {AGENTS.map(([a, name, Icon]) => (
            <button key={a} className="menu-item" role="menuitemradio" aria-checked={a === defaults.agent} onClick={() => onDefaults({ ...defaults, agent: a })}>
              <Icon size={16} strokeWidth={1.5} />{name}{a === defaults.agent && <Check className="check" size={16} strokeWidth={1.5} />}
            </button>
          ))}
          <div className="menu-help">New session은 여기서 고른 에이전트와 폴더로 열립니다.</div>
        </div>
      )}
    </div>
  );
}
