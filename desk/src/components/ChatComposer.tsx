import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown, CornerDownLeft, Plus, Square } from "lucide-react";
import { BorderBeam } from "border-beam";
import { enterAction, modelLabel } from "../lib/composer";
import { attachScrollReveal } from "../lib/useScrollReveal";

type Attachment = { path: string; mime: string; url: string };
type Providers = { provider: string; providerName: string; models: string[] }[];

export default function ChatComposer({ running, disabled, focused, model, onSend, onStop, onAttach, onListModels, onSetModel }: {
  model?: string;
  running: boolean;
  disabled: boolean;
  focused: boolean;
  onSend: (text: string, attachments: { path: string; mime: string }[]) => void;
  onStop: () => void;
  onAttach: (bytes: Uint8Array, mime: string) => Promise<{ path: string; mime: string }>;
  onListModels?: () => Promise<Providers>;
  onSetModel?: (provider: string, model: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [atts, setAtts] = useState<Attachment[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const live = useRef<Attachment[]>([]);
  const [menu, setMenu] = useState<"closed" | "loading" | "ready" | "error">("closed");
  const [providers, setProviders] = useState<Providers>([]);
  const [menuErr, setMenuErr] = useState("");
  const modelRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  live.current = atts;

  // Grow with content up to 8 lines, then scroll.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 20;
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    const max = line * 8 + pad;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [text]);

  // Focus only on mount and on the false -> true transition, so a selection elsewhere in the pane is not stolen.
  useEffect(() => { if (focused) ref.current?.focus(); }, [focused]);
  useEffect(() => () => live.current.forEach((a) => URL.revokeObjectURL(a.url)), []);

  useEffect(() => {
    if (menu === "closed") return;
    const away = (e: MouseEvent) => { const t = e.target as Node; if (!modelRef.current?.contains(t) && !menuRef.current?.contains(t)) setMenu("closed"); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu("closed"); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [menu]);
  useEffect(() => { if ((running || disabled) && menu !== "closed") setMenu("closed"); }, [running, disabled, menu]);
  const msg = (x: unknown) => String((x as { message?: string })?.message ?? x).split(/\r?\n/)[0];
  const toggleMenu = () => {
    if (menu !== "closed" || !onListModels) { setMenu("closed"); return; }
    setMenu("loading");
    onListModels().then((p) => { setProviders(p); setMenu("ready"); }, (x) => { setMenuErr(msg(x)); setMenu("error"); });
  };
  const pick = (provider: string, m: string) => {
    setMenu("closed");
    if (m === model) return;
    onSetModel?.(provider, m).then(() => setErr(null), (x) => setErr(`모델을 바꾸지 못했습니다: ${msg(x)}`));
  };

  const empty = !text.trim() && atts.length === 0;
  const send = () => {
    if (disabled || empty) return;
    onSend(text.trim(), atts.map(({ path, mime }) => ({ path, mime })));
    atts.forEach((a) => URL.revokeObjectURL(a.url));
    setText(""); setAtts([]); setErr(null);
  };
  const remove = (a: Attachment) => { URL.revokeObjectURL(a.url); setAtts((l) => l.filter((x) => x !== a)); };
  const addFiles = (files: File[]) => files.forEach(async (f) => {
    try {
      const r = await onAttach(new Uint8Array(await f.arrayBuffer()), f.type);
      setAtts((l) => [...l, { path: r.path, mime: r.mime, url: URL.createObjectURL(f) }]);
      setErr(null);
    } catch (x) {
      setErr(msg(x));
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

  const stopMode = running && empty;
  return (
    <div className="chat-composer">
      {err && <div className="chat-composer-err">{err}</div>}
      {/* Always mounted; only `active` flips, so the textarea keeps focus and text while the agent runs. */}
      {menu !== "closed" && (
        <div className="menu chat-model-menu" role="menu" ref={(el) => { menuRef.current = el; if (el) attachScrollReveal(el); }}>
          {menu === "loading" && <div className="menu-label">불러오는 중…</div>}
          {menu === "error" && <div className="menu-label">{menuErr}</div>}
          {menu === "ready" && providers.length === 0 && <div className="menu-label">사용할 수 있는 모델이 없습니다</div>}
          {menu === "ready" && providers.map((p) => (
            <div key={p.provider}>
              <div className="menu-label">{p.providerName}</div>
              {p.models.map((m) => (
                <button key={m} className="menu-item" role="menuitemradio" aria-checked={m === model} title={m} onClick={() => pick(p.provider, m)}>
                  <span className="ellipsis">{m}</span>{m === model && <Check className="check" size={16} strokeWidth={1.5} />}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      <BorderBeam size="md" borderRadius={16} theme="dark" colorVariant="ocean" strength={0.6} active={running}>
        <div className="chat-box" onMouseDown={(e) => { if (!(e.target instanceof HTMLElement && e.target.closest("button, textarea"))) { e.preventDefault(); ref.current?.focus(); } }}>
          {atts.length > 0 && (
            <div className="chat-thumbs">
              {atts.map((a) => (
                <div className="chat-thumb" key={a.path}>
                  <img src={a.url} alt="" />
                  <button className="chat-thumb-x" aria-label="첨부 제거" onClick={() => remove(a)}>×</button>
                </div>
              ))}
            </div>
          )}
          <div className="chat-row">
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden onChange={onPick} />
            <button className="chat-icon-btn" aria-label="이미지 첨부" title="이미지 첨부" disabled={disabled} onClick={() => fileRef.current?.click()}><Plus size={16} strokeWidth={1.75} /></button>
            <textarea
              ref={ref}
              rows={1}
              value={text}
              placeholder="메시지 입력 — Enter 전송, Shift+Enter 줄바꿈"
              onChange={(e) => setText(e.target.value)}
              onPaste={onPaste}
              onKeyDown={(e) => {
                if (enterAction({ key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode }) === "send") { e.preventDefault(); send(); }
              }}
            />
            <button className="chat-model" ref={modelRef} aria-haspopup="menu" aria-expanded={menu !== "closed"} disabled={disabled || running || !onListModels}
              title={running ? "작업 중에는 모델을 바꿀 수 없습니다" : model ? "Model · " + model : "모델"} onClick={toggleMenu}>
              <span className="ellipsis">{model ? modelLabel(model) : "모델"}</span><ChevronDown size={12} strokeWidth={1.5} />
            </button>
            {stopMode
              ? <button className="chat-icon-btn" aria-label="중지" title="중지" onClick={onStop}><Square size={12} strokeWidth={1.75} /></button>
              : <button className="chat-icon-btn chat-send" aria-label="전송" title="전송 (Enter)" onClick={send} hidden={empty || disabled}><CornerDownLeft size={16} strokeWidth={1.75} /></button>}
          </div>
        </div>
      </BorderBeam>
    </div>
  );
}
