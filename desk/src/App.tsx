import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ChartNoAxesColumn, PanelLeftOpen } from "lucide-react";
import "./App.css";
import { useDesk } from "./lib/useDesk";
import { HOME, isTauri, usageHistory, windowNew, paneCreate } from "./lib/backend";
import { toSession } from "./lib/useTauriDesk";
import type { Session } from "./lib/types";
import Sidebar from "./components/Sidebar";
import PaneGrid from "./components/PaneGrid";
import NewPaneMenu from "./components/NewPaneMenu";
import UsageView from "./components/UsageView";
import SettingsMenu from "./components/SettingsMenu";
import ShortcutHelp from "./components/ShortcutHelp";
import { matchDigit, matchShortcut } from "./lib/shortcuts";
import { loadNewPane, loadRecentFolders, loadSidebarWidth, pushRecent, saveNewPane, saveRecentFolders, saveSidebarWidth } from "./lib/uiSettings";
import type { AgentKind, PaneView } from "./lib/types";
import { recentFolders } from "./mock/sessions";
import { TermCtx, loadTerm, saveTerm } from "./lib/termSettings";

const seedFolders = isTauri ? [HOME] : recentFolders;

export default function App() {
  const [newPane, setNewPane] = useState(() => loadNewPane(seedFolders[0]));
  const d = useDesk(newPane.view);
  const [collapsed, setCollapsed] = useState(false);
  const [usage, setUsage] = useState(() => window.location.hash.startsWith("#usage")); // #usage opens the usage view directly
  const [history, setHistory] = useState<Session[]>([]);
  useEffect(() => {
    if (!isTauri) return;
    if (!usage) { setHistory([]); return; }
    let dead = false;
    usageHistory().then((h) => { if (!dead) setHistory(h.map((s) => toSession(s))); }, console.error);
    return () => { dead = true; };
  }, [usage]);
  const usageSessions = isTauri && history.length ? [...history.filter((h) => !d.sessions.some((s) => s.sessionId === h.sessionId)), ...d.sessions] : d.sessions;
  const [help, setHelp] = useState(false);
  const [term, setTerm] = useState(loadTerm);
  useEffect(() => saveTerm(term), [term]);
  const [width, setWidth] = useState(loadSidebarWidth);
  useEffect(() => saveSidebarWidth(width), [width]);
  useEffect(() => saveNewPane(newPane), [newPane]);
  const [folders, setFolders] = useState(() => loadRecentFolders(seedFolders));
  useEffect(() => saveRecentFolders(folders), [folders]);
  const open = (agent: AgentKind, cwd: string, view: PaneView) => { d.addPane(agent, cwd, view); setFolders((l) => pushRecent(l, cwd)); };
  const chooseFolder = (cwd: string) => { setNewPane((p) => ({ ...p, cwd })); setFolders((l) => pushRecent(l, cwd)); };
  const hotkey = useRef<(e: KeyboardEvent) => void>(() => {});
  hotkey.current = (e) => {
    const id = matchShortcut(e);
    if (!id) {
      const n = matchDigit(e);
      if (n !== null && d.panes[n]) { e.preventDefault(); e.stopPropagation(); d.focusPane(d.panes[n].id); }
      return;
    }
    e.preventDefault(); e.stopPropagation();
    if (id === "new") open(newPane.agent, newPane.cwd, newPane.view);
    else if (id === "search") { flushSync(() => setCollapsed(false)); document.getElementById("session-search")?.focus(); } // flushSync: the sidebar must be mounted before focusing
    else if (id === "close") { if (d.focusedPaneId) d.closePane(d.focusedPaneId); }
    else if (id === "window") { if (isTauri) windowNew().catch(console.error); }
    else if (id === "next" || id === "prev") {
      const n = d.panes.length;
      if (!n) return;
      const i = d.panes.findIndex((p) => p.id === d.focusedPaneId);
      const j = i < 0 ? (id === "next" ? 0 : n - 1) : (i + (id === "next" ? 1 : -1) + n) % n;
      d.focusPane(d.panes[j].id);
    }
    else if (id === "sidebar") setCollapsed((c) => !c);
    else if (id === "usage") setUsage((u) => !u);
    else if (id === "help") setHelp((h) => !h);
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => hotkey.current(e);
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, []);
  return (
    <TermCtx.Provider value={term}>
    <div className="app">
      <header className="topbar">
        {collapsed && <button className="icon-btn" aria-label="Expand sidebar" onClick={() => setCollapsed(false)}><PanelLeftOpen size={16} strokeWidth={1.5} /></button>}
        <img src="/icon.svg" alt="" width={18} height={18} /><span className="app-name">Perch</span>
        <span className="muted">{`${d.panes.length} open`}</span>
        <span className="grow" />
        <button className={`icon-btn${usage ? " on" : ""}`} aria-label="Token usage" aria-pressed={usage} title="Token usage" onClick={() => setUsage((u) => !u)}><ChartNoAxesColumn size={16} strokeWidth={1.5} /></button>
        <ShortcutHelp open={help} onOpenChange={setHelp} />
        <SettingsMenu value={term} onChange={setTerm} pane={newPane} onPane={setNewPane} folders={folders} />
        <NewPaneMenu variant="bar" defaults={newPane} folders={folders} onAdd={open} onDefaults={setNewPane} onChooseFolder={chooseFolder} />
      </header>
      <div className="main">
        {!collapsed && (
          <Sidebar sessions={d.sessions} panes={d.panes} now={d.now} focusedPaneId={d.focusedPaneId}
            onFocus={d.focusSession} onApprove={d.approve} onStop={d.stop} onClosePane={d.closePane} width={width} onResize={setWidth} onCollapse={() => setCollapsed(true)} onUsage={() => setUsage(true)} onNew={(cwd) => open(newPane.agent, cwd, newPane.view)}
            newSession={<NewPaneMenu variant="side" defaults={newPane} folders={folders} onAdd={open} onDefaults={setNewPane} onChooseFolder={chooseFolder} />} />
        )}
        <div className="stage" style={{ display: usage ? "none" : "flex" }}>
        <PaneGrid panes={d.panes} sessions={d.sessions} now={d.now} focusedPaneId={d.focusedPaneId}
          onFocus={d.focusPane} onClose={d.closePane} stopped={d.stopped} onStop={d.stop} />
        </div>
        {usage && <UsageView sessions={usageSessions} now={d.now} onPick={(id) => { const h = d.sessions.some((x) => x.sessionId === id) ? null : history.find((x) => x.sessionId === id); if (h) paneCreate("hermes", h.cwd, id, newPane.view).then(d.focusPane, console.error); /* history-only session: resume it */ else d.focusSession(id); setUsage(false); }} onClose={() => setUsage(false)} />}
      </div>
    </div>
    </TermCtx.Provider>
  );
}
