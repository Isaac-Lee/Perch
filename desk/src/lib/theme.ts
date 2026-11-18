import { useSyncExternalStore } from "react";
import type { ITheme } from "@xterm/xterm";
import type { ThemeId } from "./uiSettings";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "./backend";

export const applyTheme = (t: ThemeId) => {
  document.documentElement.dataset.theme = t;
  // Native titlebar (Windows) only knows light/dark.
  if (isTauri) getCurrentWindow().setTheme(t === "light" ? "light" : "dark").catch(() => {});
};

const watch = (cb: () => void) => {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => mo.disconnect();
};

/** Terminal colours from the --term-* tokens (light theme keeps terminals dark, see tokens.css). */
export function termTheme(): ITheme {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return { background: v("--term-bg"), foreground: v("--term-fg"), cursor: v("--term-cursor") };
}

/** Calls cb on every theme change; returns the unsubscribe. */
export const onThemeChange = (cb: () => void) => watch(cb);

/** For widgets that only know light/dark (thinking-orbs): true under the light theme. */
export const useIsLight = () => useSyncExternalStore(watch, () => document.documentElement.dataset.theme === "light");
