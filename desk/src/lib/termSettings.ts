import { createContext } from "react";
import type { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";

export interface TermSettings { fontFamily: string; fontSize: number }
export const DEFAULT_TERM: TermSettings = { fontFamily: "D2Coding", fontSize: 13 };
export const FONT_CHOICES = ["D2Coding", "Monoplex KR", "Cascadia Mono", "Consolas", "Menlo"];
const KEY = "perch.terminal";
export const clampSize = (n: number) => Math.min(24, Math.max(10, Math.round(n) || DEFAULT_TERM.fontSize));
// ponytail: settings live in localStorage until stage 2 moves them to a Tauri config file
export function loadTerm(): TermSettings {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (v && typeof v.fontFamily === "string" && v.fontFamily.trim()) return { fontFamily: v.fontFamily, fontSize: clampSize(v.fontSize) };
  } catch { /* ignore */ }
  return DEFAULT_TERM;
}
export function saveTerm(s: TermSettings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}
/** CSS font stack: chosen/custom family first, then the fallbacks. */
export const fontStack = (f: string) => `"${f.replace(/"/g, "")}", "D2Coding", "Cascadia Mono", Consolas, Menlo, monospace`;
export const TermCtx = createContext<TermSettings>(DEFAULT_TERM);

/** GPU renderer; falls back to the DOM renderer if WebGL is unavailable. Call right after term.open(). */
export function loadWebgl(term: Terminal) {
  try { const gl = new WebglAddon(); gl.onContextLoss(() => gl.dispose()); term.loadAddon(gl); } catch { /* DOM renderer */ }
}
