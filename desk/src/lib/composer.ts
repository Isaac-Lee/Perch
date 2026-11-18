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
