// Model-facing text Hermes injects into user rows. Perch must never show it as the user's words.

// Mirrors CONTROL_FRAME_OPENERS in hermes agent/prompt_builder.py (text after "["); "/?" there means an optional "/".
const OPENERS = ["/?OUT-OF-BAND USER MESSAGE", "CONTEXT COMPACTION", "CONTEXT SUMMARY]", "PRIOR CONTEXT", "Runtime note:", "System note:", "System:", "SYSTEM]", "IMPORTANT:", "Planning state preserved", "ASYNC DELEGATION"];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace("/\\?", "/?");
const FRAME = new RegExp(`^\\[(?:${OPENERS.map(esc).join("|")})`);
const STEER = /\[OUT-OF-BAND USER MESSAGE[^\]]*\]\s*([\s\S]*?)\s*\[\/OUT-OF-BAND USER MESSAGE\]/;
// _enrich_message_with_vision (gateway/run_inbound.py): per image a "[The user sent an image...]" note, then "\n\n" + the typed text.
const IMAGE_NOTE = /^\[The user sent an image(?:~ Here's what[\s\S]*?\]\n\[If you need a closer look[^\]]*\]|[^\]]*\])\s*/;

/** The text of a steer wrapper (open marker, text, close marker), or null when `text` holds none. */
export const unwrapSteer = (text: string): string | null => STEER.exec(text)?.[1] ?? null;

/** True for a Hermes control frame or "[System: ...": never user-typed, hide it. */
export const isControlFrame = (text: string): boolean => FRAME.test(text.trim()) || text.trim().startsWith("[System:");

/** The user-typed part of an image-described row ("[이미지]" when only the description is left), or `text` unchanged. */
export function stripImageNotes(text: string): string {
  let t = text.trimStart();
  if (!t.startsWith("[The user sent an image")) return text;
  for (let m = IMAGE_NOTE.exec(t); m; m = IMAGE_NOTE.exec(t)) t = t.slice(m[0].length);
  return t.trim() ? t : "[이미지]";
}

/** What to show for a user row, or null to hide it. */
export function userText(text: string): string | null {
  const steer = unwrapSteer(text);
  if (steer !== null) return steer.trim() ? steer : null;
  return isControlFrame(text) ? null : stripImageNotes(text);
}
