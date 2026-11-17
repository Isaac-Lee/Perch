import { useEffect, useRef, useState } from "react";
import { Minus, Plus, Settings } from "lucide-react";
import type { AgentKind } from "../lib/types";
import type { NewPaneDefaults } from "../lib/uiSettings";
import { recentFolders } from "../mock/sessions";
import { FONT_CHOICES, clampSize, type TermSettings } from "../lib/termSettings";

const AGENT_CHOICES: [AgentKind, string][] = [["hermes", "Hermes"], ["opencode", "OpenCode"], ["shell", "셸"]];

export default function SettingsMenu({ value, onChange, pane, onPane }: {
  value: TermSettings; onChange: (s: TermSettings) => void; pane: NewPaneDefaults; onPane: (v: NewPaneDefaults) => void;
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
  const size = (n: number) => onChange({ ...value, fontSize: clampSize(n) });
  return (
    <div className="menu-wrap" ref={ref}>
      <button className="icon-btn" aria-label="설정" aria-expanded={open} onClick={() => setOpen(!open)}><Settings size={16} strokeWidth={1.5} /></button>
      {open && (
        <div className="menu settings">
          <div className="menu-label">터미널 글꼴</div>
          <select className="field" value={preset ? value.fontFamily : ""} onChange={(e) => e.target.value && onChange({ ...value, fontFamily: e.target.value })}>
            {!preset && <option value="">직접 입력</option>}
            {FONT_CHOICES.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <input className="field" placeholder="직접 입력" aria-label="글꼴 직접 입력" defaultValue={preset ? "" : value.fontFamily}
            onChange={(e) => e.target.value.trim() && onChange({ ...value, fontFamily: e.target.value.trim() })} />
          <div className="menu-label">글자 크기</div>
          <div className="stepper">
            <button className="icon-btn" aria-label="줄이기" onClick={() => size(value.fontSize - 1)}><Minus size={16} strokeWidth={1.5} /></button>
            <input className="field num" type="number" min={10} max={24} value={value.fontSize} onChange={(e) => size(e.target.valueAsNumber)} />
            <button className="icon-btn" aria-label="키우기" onClick={() => size(value.fontSize + 1)}><Plus size={16} strokeWidth={1.5} /></button>
          </div>
          <div className="menu-label">새 칸 기본 실행</div>
          <select className="field" aria-label="새 칸 기본 실행" value={pane.agent} onChange={(e) => onPane({ ...pane, agent: e.target.value as AgentKind })}>
            {AGENT_CHOICES.map(([a, n]) => <option key={a} value={a}>{n}</option>)}
          </select>
          <div className="menu-label">기본 폴더</div>
          <select className="field" aria-label="기본 폴더" value={recentFolders.includes(pane.cwd) ? pane.cwd : ""} onChange={(e) => e.target.value && onPane({ ...pane, cwd: e.target.value })}>
            {!recentFolders.includes(pane.cwd) && <option value="">직접 입력</option>}
            {recentFolders.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <input className="field" placeholder="직접 입력" aria-label="기본 폴더 직접 입력" defaultValue={recentFolders.includes(pane.cwd) ? "" : pane.cwd}
            onChange={(e) => e.target.value.trim() && onPane({ ...pane, cwd: e.target.value.trim() })} />
        </div>
      )}
    </div>
  );
}
