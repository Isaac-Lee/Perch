/** "Label — detail" / "Label: detail" / "Label - detail" → [label, detail]; no separator → whole text is the label. */
export function splitChoice(c: string): [string, string] {
  const m = c.match(/^(.{1,60}?)\s*(?:\s[—–-]\s|:\s|\n)\s*([\s\S]+)$/);
  return m ? [m[1].trim(), m[2].trim()] : [c.trim(), ""];
}

/** A choice without Hermes' trailing "(Recommended)" tag. */
export const stripRecommended = (c: string): string => c.replace(/\s*\(Recommended\)$/, "");
