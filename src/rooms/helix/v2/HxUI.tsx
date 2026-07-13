// In-app UI primitives — toasts + a prompt/confirm modal. Replaces window.prompt/
// window.alert (which DO NOT WORK in Electron). Every action gives visible feedback.
import React, { createContext, useCallback, useContext, useRef, useState } from "react";

interface PromptOpts { title: string; label?: string; placeholder?: string; defaultValue?: string; confirmText?: string; }
interface Ctx {
  toast: (msg: string, tone?: "info" | "good" | "warn" | "bad") => void;
  prompt: (o: PromptOpts) => Promise<string | null>;
}
const UICtx = createContext<Ctx>({ toast: () => {}, prompt: async () => null });
export const useUI = () => useContext(UICtx);

interface Toast { id: number; msg: string; tone: string; }

export function UIProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [modal, setModal] = useState<(PromptOpts & { resolve: (v: string | null) => void }) | null>(null);
  const [val, setVal] = useState("");
  const idRef = useRef(0);

  const toast = useCallback((msg: string, tone: string = "info") => {
    const id = ++idRef.current;
    setToasts(t => [...t, { id, msg, tone }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3600);
  }, []);

  const prompt = useCallback((o: PromptOpts) => new Promise<string | null>((resolve) => {
    setVal(o.defaultValue || "");
    setModal({ ...o, resolve });
  }), []);

  const close = (v: string | null) => { modal?.resolve(v); setModal(null); };

  return (
    <UICtx.Provider value={{ toast, prompt }}>
      {children}
      {/* toast stack */}
      <div className="hxv-toasts">
        {toasts.map(t => (
          <div key={t.id} className={"hxv-toast " + t.tone}>
            <span className="hxv-toast-dot" />{t.msg}
          </div>
        ))}
      </div>
      {/* prompt modal */}
      {modal && (
        <div className="hxv-modal-scrim" onClick={() => close(null)}>
          <div className="hxv-modal" onClick={e => e.stopPropagation()}>
            <div className="hxv-modal-t">{modal.title}</div>
            {modal.label && <div className="hxv-modal-l">{modal.label}</div>}
            <input className="hxv-dec-input" autoFocus value={val} placeholder={modal.placeholder}
              onChange={e => setVal(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") close(val.trim() || null); if (e.key === "Escape") close(null); }} />
            <div className="hxv-modal-actions">
              <button className="hxv-btn ghost" onClick={() => close(null)}>Cancel</button>
              <button className="hxv-btn solid" onClick={() => close(val.trim() || null)}>{modal.confirmText || "Create"}</button>
            </div>
          </div>
        </div>
      )}
    </UICtx.Provider>
  );
}
