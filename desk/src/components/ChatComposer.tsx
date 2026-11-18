import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown, CornerDownLeft, Plus, Square } from "lucide-react";
import { applyCompletion, EFFORT_LEVELS, enterAction, modelLabel } from "../lib/composer";
import { attachScrollReveal } from "../lib/useScrollReveal";

type Attachment = { path: string; mime: string; url: string };
type Providers = { provider: string; providerName: string; models: string[] }[];
type SlashItem = { text: string; display?: string; meta?: string; kind?: string | null };
type SlashResult = { items: SlashItem[]; replaceFrom: number };

export default function ChatComposer({ running, disabled, focused, model, effort, draft, onSend, onStop, onAttach, onListModels, onSetModel, onSetEffort, onCompleteSlash }: {
  model?: string;
  effort?: string;
  /** text handed back by a prefill directive; applied whenever `n` changes */
  draft?: { text: string; n: number };
  running: boolean;
  disabled: boolean;
  focused: boolean;
  onSend: (text: string, attachments: { path: string; mime: string }[]) => void;
  onStop: () => void;
  onAttach: (bytes: Uint8Array, mime: string) => Promise<{ path: string; mime: string }>;
  onListModels?: () => Promise<Providers>;
  onSetModel?: (provider: string, model: string) => Promise<void>;
  onSetEffort?: (effort: string) => Promise<void>;
  onCompleteSlash?: (text: string) => Promise<SlashResult>;
}) {
  const [text, setText] = useState("");
  const [atts, setAtts] = useState<Attachment[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const live = useRef<Attachment[]>([]);
  // one menu at a time: the model menu (loading / ready / error) or the effort menu
  const [menu, setMenu] = useState<"closed" | "loading" | "ready" | "error" | "effort">("closed");
  const [slash, setSlash] = useState<(SlashResult & { typed: string }) | null>(null);
  const [sel, setSel] = useState(0);
  const reqN = useRef(0);
  const completeRef = useRef(onCompleteSlash);
  completeRef.current = onCompleteSlash; // callers pass a new function every render; the debounce must not restart on it
  const slashRef = useRef<HTMLDivElement>(null);
  const effortRef = useRef<HTMLButtonElement>(null);
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
    const away = (e: MouseEvent) => { const t = e.target as Node; if (!modelRef.current?.contains(t) && !effortRef.current?.contains(t) && !menuRef.current?.contains(t)) setMenu("closed"); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu("closed"); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [menu]);
  useEffect(() => { if ((running || disabled) && menu !== "closed") setMenu("closed"); }, [running, disabled, menu]);
  useEffect(() => { if (draft?.n) { setText(draft.text); ref.current?.focus(); } }, [draft?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  // Slash popup: only for a single line starting with "/" and the caret at its end; debounced, stale answers dropped.
  useEffect(() => {
    const n = ++reqN.current;
    const el = ref.current;
    if (disabled || !completeRef.current || !text.startsWith("/") || text.includes("\n") || el?.selectionStart !== text.length) { setSlash(null); return; }
    const t = setTimeout(() => {
      completeRef.current?.(text).then((r) => {
        if (n !== reqN.current) return;
        setSlash(r.items.length ? { ...r, typed: text } : null);
        setSel(0);
      }, () => {});
    }, 120);
    return () => clearTimeout(t);
  }, [text, disabled]);
  const slashOpen = !!slash;
  useEffect(() => (slashRef.current ? attachScrollReveal(slashRef.current) : undefined), [slashOpen]);
  useEffect(() => { slashRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }); }, [sel, slash]);
  const accept = (it: SlashItem) => {
    if (!slash) return;
    setText(applyCompletion(text, it, slash.replaceFrom));
    setSlash(null); // a changed text re-queries (e.g. argument options); an unchanged one stays closed
    ref.current?.focus();
  };
  const msg = (x: unknown) => String((x as { message?: string })?.message ?? x).split(/\r?\n/)[0];
  const toggleEffort = () => setMenu(menu === "effort" ? "closed" : "effort");
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

  const pickEffort = (lv: string) => {
    setMenu("closed");
    if (lv === effort) return;
    onSetEffort?.(lv).then(() => setErr(null), (x) => setErr(`추론 강도를 바꾸지 못했습니다: ${msg(x)}`));
  };

  const empty = !text.trim() && atts.length === 0;
  const send = () => {
    if (disabled || empty) return;
    onSend(text.trim(), atts.map(({ path, mime }) => ({ path, mime })));
    atts.forEach((a) => URL.revokeObjectURL(a.url));
    setText(""); setAtts([]); setErr(null); setSlash(null);
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
      {menu === "effort" && (
        <div className="menu chat-model-menu chat-effort-menu" role="menu" ref={(el) => { menuRef.current = el; if (el) attachScrollReveal(el); }}>
          {EFFORT_LEVELS.map((lv) => (
            <button key={lv} className="menu-item" role="menuitemradio" aria-checked={lv === effort} onClick={() => pickEffort(lv)}>
              <span className="ellipsis">{lv}</span>{lv === effort && <Check className="check" size={16} strokeWidth={1.5} />}
            </button>
          ))}
        </div>
      )}
      {slash && (
        <div className="menu chat-slash-menu" role="listbox" ref={slashRef}>
          {slash.items.map((it, i) => (
            <button key={it.text + i} className={"menu-item chat-slash-item" + (i === sel ? " sel" : "")} role="option" aria-selected={i === sel}
              onMouseDown={(e) => e.preventDefault()} onClick={() => accept(it)}>
              <span className="chat-slash-name">{it.display || "/" + it.text}</span>
              {it.meta && <span className="chat-slash-meta">{it.meta}</span>}
              {it.kind === "skill" && <span className="chat-slash-tag">skill</span>}
            </button>
          ))}
        </div>
      )}
      {menu !== "closed" && menu !== "effort" && (
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
            placeholder="메시지 입력 — Enter 전송, Shift+Enter 줄바꿈, / 명령"
            onChange={(e) => setText(e.target.value)}
            onPaste={onPaste}
            onKeyDown={(e) => {
              if (slash && slash.typed === text && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                const n = slash.items.length, it = slash.items[sel];
                if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setSel((sel + (e.key === "ArrowDown" ? 1 : n - 1)) % n); return; }
                if (e.key === "Escape") { e.preventDefault(); setSlash(null); return; }
                // Enter on an already complete command still sends
                const done = applyCompletion(text, it, slash.replaceFrom).trimEnd() === text.trimEnd();
                if ((e.key === "Tab" && !e.shiftKey) || (e.key === "Enter" && !e.shiftKey && !done)) { e.preventDefault(); accept(it); return; }
              }
              if (enterAction({ key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode }) === "send") { e.preventDefault(); send(); }
            }}
          />
          <button className="chat-model chat-effort" ref={effortRef} aria-haspopup="menu" aria-expanded={menu === "effort"} disabled={disabled || running || !onSetEffort}
            title={running ? "작업 중에는 추론 강도를 바꿀 수 없습니다" : "추론 강도 · " + (effort ?? "?")} onClick={toggleEffort}>
            <span className="ellipsis">{effort ?? "추론"}</span><ChevronDown size={12} strokeWidth={1.5} />
          </button>
          <button className="chat-model" ref={modelRef} aria-haspopup="menu" aria-expanded={menu !== "closed" && menu !== "effort"} disabled={disabled || running || !onListModels}
            title={running ? "작업 중에는 모델을 바꿀 수 없습니다" : model ? "Model · " + model : "모델"} onClick={toggleMenu}>
            <span className="ellipsis">{model ? modelLabel(model) : "모델"}</span><ChevronDown size={12} strokeWidth={1.5} />
          </button>
          {stopMode
            ? <button className="chat-icon-btn" aria-label="중지" title="중지" onClick={onStop}><Square size={12} strokeWidth={1.75} /></button>
            : <button className="chat-icon-btn chat-send" aria-label="전송" title="전송 (Enter)" onClick={send} disabled={empty || disabled}><CornerDownLeft size={16} strokeWidth={1.75} /></button>}
        </div>
      </div>
    </div>
  );
}
