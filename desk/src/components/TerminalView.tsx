import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { AgentKind } from "../lib/types";
import { terminalLines } from "../mock/terminal";

export default function TerminalView({ agent }: { agent: AgentKind }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current!;
    const term = new Terminal({
      fontFamily: '"D2Coding", "Cascadia Mono", Consolas, Menlo, monospace',
      fontSize: 12, lineHeight: 1.3, cursorBlink: false, scrollback: 200,
      theme: { background: "#17181b", foreground: "#e6e6e6", cursor: "#a1a1a6" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    const doFit = () => { if (el.clientWidth > 0 && el.clientHeight > 0) fit.fit(); };
    doFit();
    terminalLines[agent].forEach((l) => term.writeln(l));
    term.onData((d) => term.write(d === "\r" ? "\r\n" : d === "\x7f" ? "\b \b" : d)); // echo only
    const ro = new ResizeObserver(doFit);
    ro.observe(el);
    return () => { ro.disconnect(); term.dispose(); };
  }, [agent]);
  return <div className="term" ref={ref} />;
}
