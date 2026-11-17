export type ShortcutId = "new" | "search" | "close" | "next" | "prev" | "sidebar" | "usage" | "help";
export interface Shortcut { id: ShortcutId; code: string; shift: boolean; key: string; label: string }

// 모두 Ctrl(맥은 ⌘) 필수. 터미널 입력과 겹치지 않게 Ctrl+Shift 조합 또는 Ctrl+Tab만 쓴다.
export const SHORTCUTS: Shortcut[] = [
  { id: "new",     code: "KeyN",  shift: true,  key: "N",   label: "New session" },
  { id: "search",  code: "KeyF",  shift: true,  key: "F",   label: "Search sessions" },
  { id: "close",   code: "KeyW",  shift: true,  key: "W",   label: "Close session" },
  { id: "next",    code: "Tab",   shift: false, key: "Tab", label: "Next session" },
  { id: "prev",    code: "Tab",   shift: true,  key: "Tab", label: "Previous session" },
  { id: "sidebar", code: "KeyB",  shift: true,  key: "B",   label: "Toggle sidebar" },
  { id: "usage",   code: "KeyU",  shift: true,  key: "U",   label: "Token usage" },
  { id: "help",    code: "Slash", shift: true,  key: "/",   label: "Shortcuts" },
];

export function matchShortcut(e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; code: string }): ShortcutId | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  return SHORTCUTS.find((s) => s.code === e.code && s.shift === e.shiftKey)?.id ?? null;
}

export function formatShortcut(id: ShortcutId, mac = /Mac/.test(navigator.platform)): string {
  const s = SHORTCUTS.find((x) => x.id === id)!;
  return mac ? `⌘${s.shift ? "⇧" : ""}${s.key}` : `Ctrl+${s.shift ? "Shift+" : ""}${s.key}`;
}

export const MOD_KEY = /Mac/.test(navigator.platform) ? "⌘" : "Ctrl+";

// Ctrl+1~9 → 0~8
export function matchDigit(e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; code: string }): number | null {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return null;
  const m = /^Digit([1-9])$/.exec(e.code);
  return m ? Number(m[1]) - 1 : null;
}
