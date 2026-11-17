import { useEffect, useState } from "react";
import { PanelLeftOpen } from "lucide-react";
import "./App.css";
import { useMockDesk } from "./mock/useMockDesk";
import Sidebar from "./components/Sidebar";
import PaneGrid from "./components/PaneGrid";
import NewPaneMenu from "./components/NewPaneMenu";
import SettingsMenu from "./components/SettingsMenu";
import { loadNewPane, loadSidebarWidth, saveNewPane, saveSidebarWidth } from "./lib/uiSettings";
import { recentFolders } from "./mock/sessions";
import { TermCtx, loadTerm, saveTerm } from "./lib/termSettings";

export default function App() {
  const d = useMockDesk();
  const [collapsed, setCollapsed] = useState(false);
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
        {collapsed && <button className="icon-btn" aria-label="패널 펼치기" onClick={() => setCollapsed(false)}><PanelLeftOpen size={16} strokeWidth={1.5} /></button>}
        <span className="app-name">Agent Desk</span>
        <span className="muted">칸 {d.panes.length}</span>
        <span className="grow" />
        <SettingsMenu value={term} onChange={setTerm} pane={newPane} onPane={setNewPane} />
        <NewPaneMenu onAdd={d.addPane} defaults={newPane} />
      </header>
      <div className="main">
        {!collapsed && (
          <Sidebar sessions={d.sessions} panes={d.panes} now={d.now} focusedPaneId={d.focusedPaneId}
            onFocus={d.focusSession} onApprove={d.approve} onStop={d.stop} width={width} onResize={setWidth} onCollapse={() => setCollapsed(true)} />
        )}
        <PaneGrid panes={d.panes} sessions={d.sessions} now={d.now} focusedPaneId={d.focusedPaneId}
          onFocus={d.focusPane} onClose={d.closePane} stopped={d.stopped} onStop={d.stop} />
      </div>
    </div>
    </TermCtx.Provider>
  );
}
