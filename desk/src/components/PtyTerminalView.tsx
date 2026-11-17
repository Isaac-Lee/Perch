import { useContext, useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import "@xterm/xterm/css/xterm.css";
import { TermCtx, fontStack, loadWebgl } from "../lib/termSettings";
import { attachScrollReveal } from "../lib/useScrollReveal";
import { paneAttach, paneResize, paneWrite } from "../lib/backend";

export default function PtyTerminalView({ paneId, focused }: { paneId: string; focused: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const cfg = useContext(TermCtx);
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const api = useRef<{ term: Terminal; fit: () => void } | null>(null);

  useEffect(() => {
    const el = ref.current!;
    let dead = false;
    let cleanup = () => {};
    const { fontFamily, fontSize } = cfgRef.current;
    Promise.all([document.fonts.load(`${fontSize}px "${fontFamily}"`), document.fonts.load(`bold ${fontSize}px "${fontFamily}"`)])
      .catch(() => {}).then(() => {
        if (dead) return;
        const c = cfgRef.current;
        const term = new Terminal({
          fontFamily: fontStack(c.fontFamily), fontSize: c.fontSize, lineHeight: 1.3, cursorBlink: true, scrollback: 5000, allowProposedApi: true,
          theme: { background: "#17181b", foreground: "#e6e6e6", cursor: "#a1a1a6" },
        });
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.loadAddon(new Unicode11Addon());
        term.unicode.activeVersion = "11";
        term.open(el);
        loadWebgl(term);
        const fit = () => { if (el.clientWidth > 0 && el.clientHeight > 0) fitAddon.fit(); };
        fit();
        const r = term.onRender(() => { r.dispose(); fit(); }); // re-measure once cell metrics have settled
        const vp = el.querySelector<HTMLElement>(".xterm-viewport");
        const detach = vp ? attachScrollReveal(vp) : () => {};
        paneAttach(paneId, term.cols, term.rows, (b) => term.write(b)).catch(console.error);
        term.onData((d) => { paneWrite(paneId, d).catch(console.error); });
        term.onResize(({ cols, rows }) => { paneResize(paneId, cols, rows).catch(console.error); });
        const ro = new ResizeObserver(fit);
        ro.observe(el);
        api.current = { term, fit };
        if (focusedRef.current) term.focus();
        cleanup = () => { ro.disconnect(); detach(); term.dispose(); api.current = null; };
      });
    return () => { dead = true; cleanup(); };
  }, [paneId]);

  useEffect(() => { if (focused) api.current?.term.focus(); }, [focused]);

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
