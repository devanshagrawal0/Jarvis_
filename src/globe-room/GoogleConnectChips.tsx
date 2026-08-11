import { useEffect, useState } from "react";

// One place for the "grant a missing Google capability" chips, so every Today surface (compact card,
// expanded dashboard, command-center) shows the SAME inline connect instead of sending the owner to a
// separate settings screen. Self-contained: it reads live capability health and re-checks when the
// window regains focus (right after the consent popup closes), so a chip vanishes once its scope is
// granted. Renders nothing when Google isn't connected or everything is already granted.

async function connectGoogle(bundle: string) {
  try {
    const r = await fetch(`/api/oauth/google/start?bundles=${encodeURIComponent(bundle)}`);
    const d = await r.json().catch(() => ({}));
    if (d?.authorizationUrl) window.open(d.authorizationUrl, "_blank", "noopener,noreferrer");
    else document.dispatchEvent(new CustomEvent("jarvis:command", { detail: { text: `I tried to start the Google "${bundle}" connection but got no authorization URL. What's blocking it?`, files: [] } }));
  } catch {
    document.dispatchEvent(new CustomEvent("jarvis:command", { detail: { text: "The Google connection couldn't start — check that OAuth credentials are configured.", files: [] } }));
  }
}

export function GoogleConnectChips({ style }: { style?: React.CSSProperties }) {
  const [caps, setCaps] = useState<{ calWrite: boolean; mailRead: boolean } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/health");
        const j = await r.json();
        const s = j?.providers?.google?.services || {};
        if (alive) setCaps(j?.providers?.google?.connected ? { calWrite: !!s.calendar?.canWrite, mailRead: !!s.gmail?.canRead } : null);
      } catch { /* leave null → render nothing rather than a wrong prompt */ }
    };
    load();
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => { alive = false; window.removeEventListener("focus", onFocus); };
  }, []);

  if (!caps || (caps.calWrite && caps.mailRead)) return null;
  const chip: React.CSSProperties = {
    font: "600 10px Inter", color: "#4fe3ff", background: "linear-gradient(180deg,rgba(79,227,255,.16),rgba(79,227,255,.05))",
    border: "1px solid rgba(79,227,255,.42)", borderRadius: 999, padding: "4px 10px", cursor: "pointer", whiteSpace: "nowrap",
  };
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "6px 0", ...style }}>
      {!caps.calWrite ? (
        <button style={chip} title="Let Jarvis create, move and cancel calendar events — each change is previewed for your OK first." onClick={() => connectGoogle("calendar_write")}>⊕ Enable calendar editing</button>
      ) : null}
      {!caps.mailRead ? (
        <button style={chip} title="Let Jarvis read your inbox to surface replies you owe. Read-only — it never sends." onClick={() => connectGoogle("gmail_read")}>⊕ Read email</button>
      ) : null}
    </div>
  );
}
