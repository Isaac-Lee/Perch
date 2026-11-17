import { useState } from "react";
import { PanelLeftOpen } from "lucide-react";
import "./App.css";
import { useMockDesk } from "./mock/useMockDesk";
import Sidebar from "./components/Sidebar";
import PaneGrid from "./components/PaneGrid";
import NewPaneMenu from "./components/NewPaneMenu";

export default function App() {
  const d = useMockDesk();
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="app">
      <header className="topbar">
        {collapsed && <button className="icon-btn" aria-label="패널 펼치기" onClick={() => setCollapsed(false)}><PanelLeftOpen size={16} strokeWidth={1.5} /></button>}
        <span className="app-name">Agent Desk</span>
        <span className="muted">칸 {d.panes.length}</span>
        <span className="grow" />
        <NewPaneMenu onAdd={d.addPane} />
      </header>
      <div className="main">
        {!collapsed && (
          <Sidebar sessions={d.sessions} panes={d.panes} now={d.now} focusedPaneId={d.focusedPaneId}
            onFocus={d.focusSession} onApprove={d.approve} onCollapse={() => setCollapsed(true)} />
        )}
        <PaneGrid panes={d.panes} sessions={d.sessions} now={d.now} focusedPaneId={d.focusedPaneId}
          onFocus={d.focusPane} onClose={d.closePane} />
      </div>
    </div>
  );
}
