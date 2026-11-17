import { useEffect, useState } from "react";
import { ChartNoAxesColumn, PanelLeftOpen } from "lucide-react";
import "./App.css";
import { useMockDesk } from "./mock/useMockDesk";
import Sidebar from "./components/Sidebar";
import PaneGrid from "./components/PaneGrid";
import NewPaneMenu from "./components/NewPaneMenu";
import UsageView from "./components/UsageView";
import SettingsMenu from "./components/SettingsMenu";
import { loadNewPane, loadSidebarWidth, saveNewPane, saveSidebarWidth } from "./lib/uiSettings";
import { recentFolders } from "./mock/sessions";
import { TermCtx, loadTerm, saveTerm } from "./lib/termSettings";

export default function App() {
  const d = useMockDesk();
  const [collapsed, setCollapsed] = useState(false);
  const [usage, setUsage] = useState(() => window.location.hash.startsWith("#usage")); // #usage opens the usage view directly
  const [term, setTerm] = useState(loadTerm);
  useEffect(() => saveTerm(term), [term]);
  const [width, setWidth] = useState(loadSidebarWidth);
  useEffect(() => saveSidebarWidth(width), [width]);
  const [newPane, setNewPane] = useState(() => loadNewPane(recentFolders[0]));
  useEffect(() => saveNewPane(newPane), [newPane]);
  return (
    <TermCtx.Provider value={term}>
    <div className="app">
      <header className="topbar">
        {collapsed && <button className="icon-btn" aria-label="Expand sidebar" onClick={() => setCollapsed(false)}><PanelLeftOpen size={16} strokeWidth={1.5} /></button>}
        <img src="/icon.svg" alt="" width={18} height={18} /><span className="app-name">Perch</span>
        <span className="muted">{`${d.panes.length} open`}</span>
        <span className="grow" />
        <button className={`icon-btn${usage ? " on" : ""}`} aria-label="Token usage" aria-pressed={usage} title="Token usage" onClick={() => setUsage((u) => !u)}><ChartNoAxesColumn size={16} strokeWidth={1.5} /></button>
        <SettingsMenu value={term} onChange={setTerm} pane={newPane} onPane={setNewPane} />
        <NewPaneMenu onAdd={d.addPane} defaults={newPane} />
      </header>
      <div className="main">
        {!collapsed && (
          <Sidebar sessions={d.sessions} panes={d.panes} now={d.now} focusedPaneId={d.focusedPaneId}
            onFocus={d.focusSession} onApprove={d.approve} onStop={d.stop} width={width} onResize={setWidth} onCollapse={() => setCollapsed(true)} onUsage={() => setUsage(true)} />
        )}
        <div className="stage" style={{ display: usage ? "none" : "flex" }}>
        <PaneGrid panes={d.panes} sessions={d.sessions} now={d.now} focusedPaneId={d.focusedPaneId}
          onFocus={d.focusPane} onClose={d.closePane} stopped={d.stopped} onStop={d.stop} />
        </div>
        {usage && <UsageView sessions={d.sessions} now={d.now} onPick={(id) => { d.focusSession(id); setUsage(false); }} onClose={() => setUsage(false)} />}
      </div>
    </div>
    </TermCtx.Provider>
  );
}
