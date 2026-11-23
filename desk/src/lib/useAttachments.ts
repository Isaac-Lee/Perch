import { useEffect, useRef, useState } from "react";

/** An image waiting to be sent: its gateway path, mime, and a preview URL (absent for an image already in the transcript). */
export type Attachment = { path: string; mime: string; url?: string };
const msg = (x: unknown) => String((x as { message?: string })?.message ?? x).split(/\r?\n/)[0];

/** Attach flow shared by the composer and the bubble editor: upload through `onAttach`, count pending uploads, paste/pick helpers. */
export function useAttachments(onAttach: (bytes: Uint8Array, mime: string) => Promise<{ path: string; mime: string }>) {
  const [atts, setAtts] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(0); // images still going to the gateway: sending now would leave them out
  const [err, setErr] = useState<string | null>(null);
  const live = useRef<Attachment[]>([]);
  live.current = atts;
  useEffect(() => () => live.current.forEach((a) => a.url && URL.revokeObjectURL(a.url)), []);
  const revoke = (l: Attachment[]) => l.forEach((a) => a.url && URL.revokeObjectURL(a.url));
  const remove = (a: Attachment) => { revoke([a]); setAtts((l) => l.filter((x) => x !== a)); };
  /** Replaces the list (revoking old previews); keep=true when the old entries were just handed on. */
  const reset = (next: Attachment[] = [], keep = false) => { if (!keep) revoke(live.current); setAtts(next); setErr(null); };
  const addFiles = (files: File[]) => files.forEach(async (f) => {
    setUploading((n) => n + 1);
    try {
      const r = await onAttach(new Uint8Array(await f.arrayBuffer()), f.type);
      setAtts((l) => [...l, { path: r.path, mime: r.mime, url: URL.createObjectURL(f) }]);
      setErr(null);
    } catch (x) {
      setErr(msg(x));
    } finally {
      setUploading((n) => n - 1);
    }
  });
  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.items).filter((i) => i.kind === "file" && i.type.startsWith("image/")).map((i) => i.getAsFile()).filter((f): f is File => !!f);
    if (!files.length) return; // plain text: browser default
    if (!e.clipboardData.getData("text/plain")) e.preventDefault();
    addFiles(files);
  };
  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(e.target.files ?? []));
    e.target.value = ""; // the same file can be chosen twice
  };
  return { atts, uploading, err, setErr, remove, reset, addFiles, onPaste, onPick };
}
