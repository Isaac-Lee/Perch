// Enter sends, Shift+Enter is a newline. While an IME composes (WebView2 reports keyCode 229 for Korean), Enter only commits.
export function enterAction(e: { key: string; shiftKey: boolean; isComposing: boolean; keyCode: number }): "send" | "newline" | "none" {
  if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return "none";
  return e.shiftKey ? "newline" : "send";
}

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
export const imageExt = (mime: string): string | null => EXT[mime] ?? null;

// Chunked so a large image does not overflow the call stack.
export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Short display name of a gateway model id: the part after the last "/", first letter upper-cased. */
export function modelLabel(model: string): string {
  const m = model.slice(model.lastIndexOf("/") + 1);
  return m.charAt(0).toUpperCase() + m.slice(1);
}

/** `/` at position 0, a bare name, then whitespace or end. `/usr/local/bin` (second slash) is prose. Same rule as hermes shared slash.ts. */
export const isSlashCommand = (text: string) => /^\/[^\s/]*(?:\s|$)/.test(text);

/** `/name arg…` -> lower-cased name and trimmed arg (may span lines). */
export function parseSlash(text: string): { name: string; arg: string } {
  const m = /^(\S+)([\s\S]*)$/.exec(text.replace(/^\/+/, ""));
  return m ? { name: m[1].toLowerCase(), arg: m[2].trim() } : { name: "", arg: "" };
}

/** New textarea text after accepting a complete.slash item. replaceFrom > 1 means an argument completion. */
export const applyCompletion = (typed: string, item: { text: string }, replaceFrom: number) =>
  replaceFrom > 1 ? typed.slice(0, replaceFrom) + item.text : "/" + item.text + " ";

/** Measured: the gateway answers unsupported_command to these in slash.exec and command.dispatch; they are client-side TUI/desktop actions (new session, pickers, undo/retry, quit). `/model` is handled by the chat view itself. */
export const BLOCKED_SLASH = new Set(["new", "clear", "resume", "branch", "compress", "undo", "retry", "quit"]);

/** `/model` argument: optional `--provider <slug>` / `--provider=<slug>`, flags --global/--session/--refresh ignored, first remaining token is the model. Null when no model (or `reset`). */
export function parseModelArg(arg: string): { model: string; provider: string } | null {
  const rest: string[] = [];
  let provider = "";
  const t = arg.split(/\s+/).filter(Boolean);
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "--provider") provider = t[++i] ?? "";
    else if (t[i].startsWith("--provider=")) provider = t[i].slice(11);
    else if (!["--global", "--session", "--refresh"].includes(t[i])) rest.push(t[i]);
  }
  return rest[0] && rest[0].toLowerCase() !== "reset" ? { model: rest[0], provider } : null;
}

export const EFFORT_LEVELS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
