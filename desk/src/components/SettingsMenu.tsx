import { useEffect, useRef, useState } from "react";
import { Minus, Plus, Settings } from "lucide-react";
import type { AgentKind } from "../lib/types";
import type { NewPaneDefaults } from "../lib/uiSettings";
import { FONT_CHOICES, clampSize, type TermSettings } from "../lib/termSettings";

const CUSTOM = "__custom";
const AGENT_CHOICES: [AgentKind, string][] = [["hermes", "Hermes"], ["opencode", "OpenCode"], ["shell", "Shell"]];

export default function SettingsMenu({ value, onChange, pane, onPane, folders }: {
  value: TermSettings; onChange: (s: TermSettings) => void; pane: NewPaneDefaults; onPane: (v: NewPaneDefaults) => void; folders: string[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const preset = FONT_CHOICES.includes(value.fontFamily);
  const folderListed = folders.includes(pane.cwd);
  const [customFont, setCustomFont] = useState(!preset);
  const [customFolder, setCustomFolder] = useState(!folderListed);
  const size = (n: number) => onChange({ ...value, fontSize: clampSize(n) });
  return (
    <div className="menu-wrap" ref={ref}>
      <button className="icon-btn" aria-label="Settings" aria-expanded={open} onClick={() => setOpen(!open)}><Settings size={16} strokeWidth={1.5} /></button>
      {open && (
        <div className="menu settings">
          <div className="set-group">
            <div className="set-title">Terminal</div>
            <label className="set-row"><span>Font</span>
              <select className="field" value={customFont ? CUSTOM : value.fontFamily} onChange={(e) => {
                if (e.target.value === CUSTOM) setCustomFont(true);
                else { setCustomFont(false); onChange({ ...value, fontFamily: e.target.value }); }
              }}>
                {FONT_CHOICES.map((f) => <option key={f} value={f}>{f}</option>)}
                <option value={CUSTOM}>Custom…</option>
              </select>
            </label>
            {customFont && (
              <div className="set-row"><span />
                <input className="field" placeholder="Font name" aria-label="Custom font" autoFocus defaultValue={preset ? "" : value.fontFamily}
                  onChange={(e) => e.target.value.trim() && onChange({ ...value, fontFamily: e.target.value.trim() })} />
              </div>
            )}
            <div className="set-row"><span>Size</span>
              <div className="stepper">
                <button aria-label="Decrease" onClick={() => size(value.fontSize - 1)}><Minus size={14} strokeWidth={1.5} /></button>
                <input type="number" min={10} max={24} value={value.fontSize} onChange={(e) => size(e.target.valueAsNumber)} />
                <button aria-label="Increase" onClick={() => size(value.fontSize + 1)}><Plus size={14} strokeWidth={1.5} /></button>
              </div>
            </div>
          </div>
          <div className="set-group">
            <div className="set-title">New session</div>
            <label className="set-row"><span>Agent</span>
              <select className="field" aria-label="Default agent" value={pane.agent} onChange={(e) => onPane({ ...pane, agent: e.target.value as AgentKind })}>
                {AGENT_CHOICES.map(([a, n]) => <option key={a} value={a}>{n}</option>)}
              </select>
            </label>
            <label className="set-row"><span>Folder</span>
              <select className="field" aria-label="Default folder" title={pane.cwd} value={customFolder ? CUSTOM : pane.cwd} onChange={(e) => {
                if (e.target.value === CUSTOM) setCustomFolder(true);
                else { setCustomFolder(false); onPane({ ...pane, cwd: e.target.value }); }
              }}>
                {folders.map((f) => <option key={f} value={f}>{f}</option>)}
                <option value={CUSTOM}>Custom…</option>
              </select>
            </label>
            {customFolder && (
              <div className="set-row"><span />
                <input className="field" placeholder="Folder path" aria-label="Custom folder" autoFocus defaultValue={folderListed ? "" : pane.cwd}
                  onChange={(e) => e.target.value.trim() && onPane({ ...pane, cwd: e.target.value.trim() })} />
              </div>
            )}
            <div className="menu-help">New session은 이 에이전트와 폴더로 열립니다.</div>
          </div>
        </div>
      )}
    </div>
  );
}
