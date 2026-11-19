import { useEffect, useRef, useState } from "react";
import { Minus, Plus, Settings } from "lucide-react";
import type { AgentKind } from "../lib/types";
import { THEMES, sameFolder, type NewPaneDefaults, type ThemeId } from "../lib/uiSettings";
import { isTauri, hermesStatus, hermesConnect, hermesDisconnect, hermesGatewayStop, type HermesStatus } from "../lib/backend";
import { FONT_CHOICES, clampSize, type TermSettings } from "../lib/termSettings";

const CUSTOM = "__custom";
const AGENT_CHOICES: [AgentKind, string][] = [["hermes", "Hermes"], ["opencode", "OpenCode"], ["shell", "Shell"]];

export default function SettingsMenu({ theme, onTheme, value, onChange, pane, onPane, folders }: {
  theme: ThemeId; onTheme: (t: ThemeId) => void; value: TermSettings; onChange: (s: TermSettings) => void; pane: NewPaneDefaults; onPane: (v: NewPaneDefaults) => void; folders: string[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [hermes, setHermes] = useState<HermesStatus | null>(null);
  const [error, setError] = useState("");
  const [restart, setRestart] = useState<"" | "ask" | "done">("");
  const hermesCall = (f: () => Promise<HermesStatus>, changed = false) => {
    setError("");
    f().then((s) => { setHermes(s); if (changed || s.autoUpdated) setRestart("ask"); }, (e) => setError(String(e)));
  };
  useEffect(() => {
    if (!open) { setRestart(""); return; }
    if (isTauri) hermesCall(hermesStatus);
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const preset = FONT_CHOICES.includes(value.fontFamily);
  const folderListed = folders.some((x) => sameFolder(x, pane.cwd));
  const [customFont, setCustomFont] = useState(!preset);
  const [customFolder, setCustomFolder] = useState(!folderListed);
  const size = (n: number) => onChange({ ...value, fontSize: clampSize(n) });
  return (
    <div className="menu-wrap" ref={ref}>
      <button className="icon-btn" aria-label="Settings" aria-expanded={open} onClick={() => setOpen(!open)}><Settings size={16} strokeWidth={1.5} /></button>
      {open && (
        <div className="menu settings">
          <div className="set-group">
            <div className="set-title">Appearance</div>
            <label className="set-row"><span>Theme</span>
              <select className="field" value={theme} onChange={(e) => onTheme(e.target.value as ThemeId)}>
                {THEMES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
          </div>
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
          {isTauri && (
            <div className="set-group">
              <div className="set-title">Hermes</div>
              <div className="set-row"><span>Status</span><span className="set-value">{hermes?.connected ? "Connected" : "Not connected"}</span></div>
              {hermes?.outdated && (
                <div className="set-row"><span>훅이 이전 버전입니다</span>
                  <button className="btn" onClick={() => hermesCall(hermesConnect, true)}>Update</button>
                </div>
              )}
              {hermes && !hermes.exe && <div className="menu-help">hermes 실행 파일을 찾지 못했습니다.</div>}
              <div className="set-row"><span>Folder</span><span className="set-value ellipsis" title={hermes?.home}>{hermes?.home}</span></div>
              <div className="set-row"><span />
                <button className="btn" disabled={!hermes} onClick={() => hermesCall(hermes?.connected ? hermesDisconnect : hermesConnect, true)}>{hermes?.connected ? "Disconnect" : "Connect"}</button>
              </div>
              {restart === "ask" && <div className="menu-help">변경을 적용하려면 Hermes gateway를 다시 시작해야 합니다. 실행 중인 Hermes 작업은 중단됩니다.</div>}
              {restart === "ask" && (
                <div className="set-row"><span />
                  <button className="btn" onClick={() => { setError(""); hermesGatewayStop().then(() => setRestart("done"), (e) => setError(String(e))); }}>Restart gateway</button>
                </div>
              )}
              {restart === "done" && <div className="menu-help">gateway를 멈췄습니다. 다음 Hermes 세션부터 적용됩니다.</div>}
              {error && <div className="menu-help set-error">{error}</div>}
              <div className="menu-help">Hermes의 config.yaml에 훅을 추가합니다.</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
