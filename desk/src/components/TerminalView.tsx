import { useContext, useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { AgentKind, Session } from "../lib/types";
import { hermesScreen, terminalLines, terminalPrompt, type HermesView } from "../mock/terminal";
import { TermCtx, fontStack } from "../lib/termSettings";
import { attachScrollReveal } from "../lib/useScrollReveal";

/** Re-render a Hermes pane only when something the screen shows changes (not on the 1s heartbeat). */
const hermesKey = (s?: Session) => (s ? [s.state, s.prompt, s.tool, s.toolDetail, s.pending?.id, s.subagents.length].join("|") : "");
const emptyView: HermesView = { state: "idle", prompt: "", tool: "", toolDetail: "", pending: null, subagents: [], cwd: "", branch: null, since: 0, turnStart: null };

export default function TerminalView({ agent, stopCount = 0, session }: { agent: AgentKind; stopCount?: number; session?: Session }) {
  const ref = useRef<HTMLDivElement>(null);
  const cfg = useContext(TermCtx);
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const viewRef = useRef<HermesView>(session ?? emptyView);
  viewRef.current = session ?? emptyView;
  const api = useRef<{ term: Terminal; fit: () => void; paint: () => void } | null>(null);

  useEffect(() => {
    const el = ref.current!;
    let dead = false;
    let cleanup = () => {};
    // Load the font before opening so cell metrics (Hangul width) are measured with D2Coding.
    const { fontFamily, fontSize } = cfgRef.current;
    Promise.all([document.fonts.load(`${fontSize}px "${fontFamily}"`), document.fonts.load(`bold ${fontSize}px "${fontFamily}"`)])
      .catch(() => {}).then(() => {
        if (dead) return;
        const c = cfgRef.current;
        const term = new Terminal({
          fontFamily: fontStack(c.fontFamily), fontSize: c.fontSize, lineHeight: 1.3, cursorBlink: false, scrollback: 200,
          theme: { background: "#17181b", foreground: "#e6e6e6", cursor: "#a1a1a6" },
        });
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(el);
        let drawnCols = 0;
        // Hermes panels are sized from the terminal width, so redraw when the column count changes.
        const paint = () => {
          drawnCols = term.cols;
          term.write(hermesScreen(viewRef.current, term.cols, term.rows, undefined, true));
        };
        const fit = () => {
          if (el.clientWidth > 0 && el.clientHeight > 0) fitAddon.fit();
          if (agent === "hermes" && drawnCols && term.cols !== drawnCols) paint();
        };
        fit();
        const r = term.onRender(() => { r.dispose(); fit(); }); // re-measure once cell metrics have settled
        const vp = el.querySelector<HTMLElement>(".xterm-viewport");
        const detach = vp ? attachScrollReveal(vp) : () => {};

        if (agent === "hermes") paint();
        else {
          terminalLines[agent].forEach((l) => term.writeln(l));
          term.write(terminalPrompt(agent, term.cols));
        }
        term.onData((d) => term.write(d === "\r" ? "\r\n" : d === "\x7f" ? "\b \b" : d)); // echo only
        const ro = new ResizeObserver(fit);
        ro.observe(el);
        api.current = { term, fit, paint };
        cleanup = () => { ro.disconnect(); detach(); term.dispose(); api.current = null; };
      });
    return () => { dead = true; cleanup(); };
  }, [agent]);

  const key = hermesKey(session);
  useEffect(() => { if (agent === "hermes") api.current?.paint(); }, [agent, key]);

  const lastStop = useRef(stopCount);
  useEffect(() => {
    if (stopCount === lastStop.current) return;
    lastStop.current = stopCount;
    if (agent === "hermes") return; // the idle composer redrawn by the state change is Hermes's own answer to a stop
    api.current?.term.write("\r\n\x1b[90m⏹ Stopped\x1b[0m\r\n");
  }, [stopCount, agent]);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    a.term.options.fontFamily = fontStack(cfg.fontFamily);
    a.term.options.fontSize = cfg.fontSize;
    a.fit();
    document.fonts.load(`${cfg.fontSize}px "${cfg.fontFamily}"`).then(() => { if (api.current === a) { a.fit(); a.term.refresh(0, a.term.rows - 1); } }, () => {});
  }, [cfg]);

  return <div className="term" ref={ref} />;
}
