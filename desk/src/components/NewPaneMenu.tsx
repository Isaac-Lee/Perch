import { useEffect, useRef, useState } from "react";
import { Bot, Check, ChevronDown, Folder, FolderOpen, MessageSquare, Plus, SquareTerminal, Terminal } from "lucide-react";
import type { AgentKind, PaneView } from "../lib/types";
import type { NewPaneDefaults } from "../lib/uiSettings";
import { attachScrollReveal } from "../lib/useScrollReveal";
import { isTauri, pickFolder } from "../lib/backend";
import { folderName } from "../mock/sessions";
import { formatShortcut } from "../lib/shortcuts";

type Entry = { agent: AgentKind; view: PaneView; name: string; Icon: typeof Bot };
const ENTRIES: Entry[] = [
  { agent: "hermes", view: "chat", name: "Hermes", Icon: MessageSquare },
  { agent: "hermes", view: "tui", name: "Hermes (TUI)", Icon: Bot },
  { agent: "opencode", view: "chat", name: "OpenCode", Icon: SquareTerminal },
  { agent: "shell", view: "chat", name: "Shell", Icon: Terminal },
];
// view only matters for hermes; opencode/shell entries match on agent alone
const isCur = (e: Entry, d: NewPaneDefaults) => e.agent === d.agent && (e.agent !== "hermes" || e.view === d.view);

export default function NewPaneMenu({ defaults, folders, onAdd, onDefaults, onChooseFolder, variant = "bar" }: {
  variant?: "bar" | "side"; defaults: NewPaneDefaults; folders: string[];
  onAdd: (agent: AgentKind, cwd: string, view: PaneView) => void; onDefaults: (v: NewPaneDefaults) => void; onChooseFolder: (cwd: string) => void;
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
  const cur = ENTRIES.find((e) => isCur(e, defaults)) ?? ENTRIES[0];
  const AgentIcon = cur.Icon;
  return (
    <div className={`menu-wrap ns ns-${variant}`} ref={ref}>
      <button className="ns-open" title={`New session · ${formatShortcut("new")}`} onClick={() => onAdd(defaults.agent, defaults.cwd, defaults.view)}>
        <Plus size={16} strokeWidth={1.5} /><span>New session</span>
      </button>
      <button className="ns-target" aria-label="New session target" aria-expanded={open} title={defaults.cwd} onClick={() => setOpen(!open)}>
        <AgentIcon size={14} strokeWidth={1.5} /><span className="ellipsis">{cur.name} · {folderName(defaults.cwd)}</span><ChevronDown size={14} strokeWidth={1.5} />
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
          {ENTRIES.map((e) => (
            <button key={e.name} className="menu-item" role="menuitemradio" aria-checked={isCur(e, defaults)} onClick={() => onDefaults({ ...defaults, agent: e.agent, view: e.agent === "hermes" ? e.view : defaults.view })}>
              <e.Icon size={16} strokeWidth={1.5} />{e.name}{isCur(e, defaults) && <Check className="check" size={16} strokeWidth={1.5} />}
            </button>
          ))}
          <div className="menu-help">New session은 여기서 고른 에이전트·폴더로 열립니다. Hermes는 채팅 보기, Hermes (TUI)는 터미널 보기입니다.</div>
        </div>
      )}
    </div>
  );
}
