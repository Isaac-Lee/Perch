import { useContext, useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import "@xterm/xterm/css/xterm.css";
import { termTheme, onThemeChange } from "../lib/theme";
import { TermCtx, fontStack, loadWebgl } from "../lib/termSettings";
import { attachScrollReveal } from "../lib/useScrollReveal";
import { openUrl, paneAttach, paneResize, paneWrite } from "../lib/backend";
import type { AgentKind } from "../lib/types";

// A terminal cannot carry image bytes, so an image-only paste sends the key that makes the agent read the OS clipboard itself
// (Hermes TUI and classic CLI both take Alt+V).
const IMAGE_PASTE_KEY: Partial<Record<AgentKind, string>> = { hermes: "\x1bv", opencode: "\x16" };

export default function PtyTerminalView({ paneId, focused, agent }: { paneId: string; focused: boolean; agent: AgentKind }) {
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
          theme: termTheme(),
          // OSC 8 links (Hermes TUI renders markdown links this way) open in the browser instead of nowhere
          linkHandler: { activate: (_e, uri) => { openUrl(uri).catch(console.error); }, allowNonHttpProtocols: false },
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
        // xterm turns Ctrl+V into ^V and never pastes; Ctrl+C copies only when text is selected, otherwise it stays an interrupt.
        // e.code, not e.key: with the Korean IME on, e.key is "ㅊ"/"ㅍ".
        term.attachCustomKeyEventHandler((e) => {
          // xterm sends Shift+Enter as a bare CR (= submit). Hermes (TUI and classic) takes Alt+Enter (ESC CR) as a newline.
          if (agent === "hermes" && e.code === "Enter" && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
            if (e.type === "keydown") paneWrite(paneId, "\x1b\r").catch(console.error);
            e.preventDefault();
            return false;
          }
          if (e.type !== "keydown" || !(e.ctrlKey || e.metaKey) || e.altKey) return true;
          if (e.code === "KeyC" && (e.shiftKey || term.hasSelection())) {
            if (term.hasSelection()) navigator.clipboard.writeText(term.getSelection()).catch(console.error);
            term.clearSelection();
            e.preventDefault();
            return false;
          }
          return e.code !== "KeyV"; // false = let the browser fire its paste event, which xterm handles (bracketed paste included)
        });
        const onPaste = (e: ClipboardEvent) => {
          const dt = e.clipboardData, key = IMAGE_PASTE_KEY[agent];
          if (!dt || !key || dt.getData("text/plain") || ![...dt.items].some((i) => i.type.startsWith("image/"))) return;
          e.preventDefault();
          e.stopPropagation();
          paneWrite(paneId, key).catch(console.error);
        };
        el.addEventListener("paste", onPaste, true);
        term.onData((d) => { paneWrite(paneId, d).catch(console.error); });
        term.onResize(({ cols, rows }) => { paneResize(paneId, cols, rows).catch(console.error); });
        const offTheme = onThemeChange(() => { term.options.theme = termTheme(); });
        const ro = new ResizeObserver(fit);
        ro.observe(el);
        api.current = { term, fit };
        if (focusedRef.current) term.focus();
        cleanup = () => { offTheme(); el.removeEventListener("paste", onPaste, true); ro.disconnect(); detach(); term.dispose(); api.current = null; };
      });
    return () => { dead = true; cleanup(); };
  }, [paneId, agent]);

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
