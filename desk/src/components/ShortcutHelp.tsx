import { Fragment, useEffect, useRef } from "react";
import { Keyboard } from "lucide-react";
import { MOD_KEY, SHORTCUTS, formatShortcut } from "../lib/shortcuts";

export default function ShortcutHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onOpenChange(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onOpenChange(false); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [open, onOpenChange]);
  return (
    <div className="menu-wrap" ref={ref}>
      <button className="icon-btn" aria-label="Shortcuts" aria-expanded={open} title={`Shortcuts · ${formatShortcut("help")}`} onClick={() => onOpenChange(!open)}><Keyboard size={16} strokeWidth={1.5} /></button>
      {open && (
        <div className="menu keys-menu">
          <div className="set-title">Shortcuts</div>
          {SHORTCUTS.map((s) => (
            <Fragment key={s.id}>
              <div className="key-row"><span>{s.label}</span><kbd>{formatShortcut(s.id)}</kbd></div>
              {s.id === "prev" && <div className="key-row"><span>Go to session 1–9</span><kbd>{MOD_KEY}1–9</kbd></div>}
            </Fragment>
          ))}
          <div className="menu-help">터미널 입력과 겹치지 않도록 Ctrl+Shift 조합을 씁니다.</div>
        </div>
      )}
    </div>
  );
}
