// Shared contextual detail drawer (H9). Pixel target: ref_07. ONE right-side panel
// every surface opens: identity · full content · source+exact pointer · support ·
// lineage · confidence-with-inputs (§14 Q7 — only when computed) · audit.
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Ico } from "./hxIcons";

export interface DrawerItem {
  type: string;                       // "Evidence" | "Assertion" | "Source" | "Decision" | "Artifact"
  title: string;
  quote?: string;
  source?: string;
  pointer?: string[];                 // e.g. ["Page 3", "Section: Fees", "Lines 8–12"]
  support?: { label: string; tone: "sup" | "con" | "uns" };
  confidence?: { label: "Strong" | "Moderate" | "Weak" | "Insufficient"; inputs: [string, string][] } | null;
  lineage?: string[];
  audit?: [string, string][];
}

const Ctx = createContext<{ open: (i: DrawerItem) => void }>({ open: () => {} });
export const useDrawer = () => useContext(Ctx);

const CONF_TONE: Record<string, string> = { Strong: "high", Moderate: "med", Weak: "med", Insufficient: "med" };

export function DrawerProvider({ children, closeKey }: { children: React.ReactNode; closeKey?: string }) {
  const [item, setItem] = useState<DrawerItem | null>(null);
  const open = useCallback((i: DrawerItem) => setItem(i), []);
  // Close the drawer whenever the surface changes — it must not linger over other screens.
  useEffect(() => { setItem(null); }, [closeKey]);
  return (
    <Ctx.Provider value={{ open }}>
      {children}
      {item && <DrawerPanel item={item} onClose={() => setItem(null)} />}
    </Ctx.Provider>
  );
}

const DTABS = ["Summary", "Support", "Lineage", "Metadata"] as const;
type DTab = typeof DTABS[number];

function DrawerPanel({ item, onClose }: { item: DrawerItem; onClose: () => void }) {
  const [tab, setTab] = useState<DTab>("Summary");
  const show = (t: DTab) => tab === t;
  return (
    <>
      <div className="hxv-drawer-scrim" onClick={onClose} />
      <aside className="hxv-drawer">
        <div className="hxv-dh">
          <div>
            <div className="hxv-dh-type">{item.type}</div>
            <div className="hxv-dh-t">{item.title}</div>
          </div>
          <button className="hxv-dh-x" onClick={onClose}><Ico.x /></button>
        </div>
        <div className="hxv-dtabs">
          {DTABS.map(t => <div key={t} className={"hxv-dtab" + (tab === t ? " on" : "")} onClick={() => setTab(t)}>{t}</div>)}
        </div>
        <div className="hxv-db">
          {(show("Summary")) && item.quote && (
            <div className="hxv-dsec">
              <div className="hxv-u hxv-dsec-h">Source &amp; location</div>
              <div className="hxv-quote">“{item.quote}”</div>
              {item.source && <div style={{ fontSize: 11.5, color: "var(--v-text2)", marginTop: 9 }}>{item.source}</div>}
              {item.pointer && <div className="hxv-ptr">{item.pointer.map(p => <span key={p}>{p}</span>)}</div>}
              {item.source && <button className="hxv-btn ghost" style={{ marginTop: 11 }}><Ico.evidence /> Open source</button>}
            </div>
          )}

          {(show("Summary") || show("Support")) && item.support && (
            <div className="hxv-dsec">
              <div className="hxv-u hxv-dsec-h">Support</div>
              <span className={"hxv-conf-badge"} style={{
                color: item.support.tone === "sup" ? "var(--v-good)" : item.support.tone === "con" ? "var(--v-bad)" : "var(--v-warn)",
                background: "rgba(140,170,220,0.08)"
              }}>{item.support.label}</span>
            </div>
          )}

          {/* Confidence — ONLY when computed, always with the inputs (§14 Q7) */}
          {(show("Summary") || show("Support")) && (
          <div className="hxv-dsec">
            <div className="hxv-u hxv-dsec-h">Confidence</div>
            {item.confidence ? (
              <>
                <span className={"hxv-conf-badge hxv-badge " + CONF_TONE[item.confidence.label]}>{item.confidence.label}</span>
                <div style={{ marginTop: 10 }}>
                  {item.confidence.inputs.map(([k, v]) => (
                    <div className="hxv-why" key={k}><span className="hxv-why-k">{k}</span><span className="hxv-why-v">{v}</span></div>
                  ))}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12, color: "var(--v-text3)" }}>Not yet assessed — needs supporting sources.</div>
            )}
          </div>
          )}

          {show("Lineage") && item.lineage && (
            <div className="hxv-dsec">
              <div className="hxv-u hxv-dsec-h">Lineage</div>
              {item.lineage.map((l, i) => (
                <div key={l}>
                  <div className="hxv-lin"><span className="hxv-lin-node" />{l}</div>
                  {i < item.lineage!.length - 1 && <div className="hxv-lin-line" />}
                </div>
              ))}
            </div>
          )}

          {show("Metadata") && item.audit && (
            <div className="hxv-dsec">
              <div className="hxv-u hxv-dsec-h">Activity</div>
              {item.audit.map(([k, v]) => (
                <div className="hxv-why" key={k}><span className="hxv-why-k">{k}</span><span className="hxv-why-v">{v}</span></div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
