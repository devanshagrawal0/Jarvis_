import { useEffect, useRef, useState } from "react";
import { JarvisMarkdown } from "../JarvisMarkdown";
import { SurfaceRenderer, blocksToSurface } from "../StageRegistry";
import { api, post, resolveOwnerChallenge } from "../api";
import type { JarvisArtifact, JarvisContactCandidate, JarvisResponseCard, JarvisUiAction } from "../types";
import type { Turn } from "./brain";

// Batch 3 (plan v2 §3 row 3): the thread with instrument cards. Every card is a payload the brain
// already emits for the desktop — a Stage surface (calendar / chart / stats / list), the sources,
// an artifact, a pending approval, a contact choice, a result card. The app never invents one.

type Approval = { id: string; tool: string; risk?: string; summary?: Record<string, unknown>; expiresAt?: string; ownerChallenge?: string };

const fmtTime = (iso: string) => { try { return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); } catch { return ""; } };
const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };

function Sources({ sources }: { sources: Array<{ title?: string; url: string }> }) {
  return (
    <div className="card">
      <div className="card-head"><span className="kicker">Sources</span><span className="count">{sources.length}</span></div>
      <div className="src-row">
        {sources.slice(0, 8).map((s, i) => (
          <a key={`${s.url}-${i}`} className="src" href={s.url} target="_blank" rel="noreferrer">
            <span className="src-n">{i + 1}</span>
            <span className="src-t">{s.title || hostOf(s.url)}</span>
            <span className="src-h">{hostOf(s.url)}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

function Artifact({ a }: { a: JarvisArtifact }) {
  const name = a.name || a.filename || a.title || "file";
  const kb = a.bytes ? `${Math.max(1, Math.round(a.bytes / 1024))} KB` : "";
  const isImage = /^image\//.test(a.mediaType || "");
  return (
    <div className="card">
      {isImage && a.downloadUrl ? <img className="art-img" src={a.downloadUrl} alt={name} /> : null}
      <div className="art-row">
        <div className="art-meta"><div className="art-name">{name}</div><div className="art-sub">{[a.kind, a.mediaType, kb, a.status].filter(Boolean).join(" · ")}</div></div>
        {a.downloadUrl ? <a className="btn" href={a.downloadUrl} target="_blank" rel="noreferrer">Open</a> : null}
      </div>
    </div>
  );
}

function ResultCard({ card, onSend }: { card: JarvisResponseCard; onSend: (t: string) => void }) {
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  if (card.kind === "contact-choice" && card.candidates?.length) {
    const pick = async (c: JarvisContactCandidate) => {
      setBusy(c.handle || c.label); setErr("");
      try {
        const name = String(card.query || c.label || "").trim();
        const channel = String(card.channel || "instagram");
        await post("/api/contacts", { name, aliases: c.handle && c.handle !== name ? [c.handle] : [], channels: { [channel]: { handle: c.handle || "", threadUrl: c.threadUrl || "", profileUrl: c.profileUrl || "", avatarUrl: c.avatarUrl || "" } } });
        if (card.task) onSend(card.task);
      } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(""); }
    };
    return (
      <div className="card">
        <div className="card-head"><span className="kicker">Which one?</span></div>
        <div className="card-title">{card.title}</div>
        {card.body ? <div className="card-body">{card.body}</div> : null}
        <div className="choices">
          {card.candidates.map((c, i) => (
            <button key={`${c.handle || c.label}-${i}`} type="button" className="choice" disabled={!!busy} onClick={() => void pick(c)}>
              {c.avatarUrl ? <img className="avatar" src={c.avatarUrl} alt="" referrerPolicy="no-referrer" /> : <span className="avatar blank">{(c.label || "?").trim().charAt(0).toUpperCase()}</span>}
              <span className="choice-meta"><span className="choice-name">{c.label}</span>{c.handle ? <span className="choice-sub">@{c.handle}</span> : null}{c.detail ? <span className="choice-sub">{c.detail}</span> : null}</span>
            </button>
          ))}
        </div>
        {err ? <div className="err">{err}</div> : null}
      </div>
    );
  }
  return (
    <div className="card">
      <div className="card-head"><span className="kicker">{card.kind || "Result"}</span>{card.status ? <i className={`dot ${card.status}`} /> : null}</div>
      <div className="card-title">{card.title}</div>
      {card.value ? <div className="card-value">{card.value}</div> : null}
      {card.body ? <div className="card-body"><JarvisMarkdown text={card.body} /></div> : null}
      {card.items?.length ? <ul className="card-list">{card.items.map((it, i) => <li key={i}>{it}</li>)}</ul> : null}
    </div>
  );
}

function StageCard({ action }: { action: JarvisUiAction }) {
  const d = (action.data || {}) as { title?: string; content?: string; blocks?: any[]; loading?: string };
  const blocks = Array.isArray(d.blocks) ? d.blocks : [];
  const surface = blocks.length ? blocksToSurface(blocks) : null;
  if (!surface && !d.content && !d.loading) return null;
  return (
    <div className="card stage-card">
      <div className="card-head"><span className="kicker">{d.title || "Surface"}</span><i className="rule" /></div>
      {d.loading && !surface && !d.content ? <div className="card-body muted">{d.loading}</div> : null}
      {surface ? <SurfaceRenderer surface={surface} /> : null}
      {!surface && d.content ? <div className="card-body"><JarvisMarkdown text={d.content} /></div> : null}
    </div>
  );
}

function ApprovalCard({ approval, onDecided }: { approval: Approval; onDecided: (text: string) => void }) {
  const [busy, setBusy] = useState<"approve" | "deny" | "">("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");
  const decide = async (decision: "approve" | "deny") => {
    setBusy(decision); setErr("");
    try {
      const ownerChallenge = await resolveOwnerChallenge(approval.id, approval.ownerChallenge);
      const r = await post<any>(`/api/confirmations/${encodeURIComponent(approval.id)}/${decision}`, { ownerChallenge });
      if (decision === "approve" && r?.ok === false) { setErr(String(r?.error || `${approval.tool} did not complete.`)); return; }
      const text = decision === "approve" ? r?.result ?? r?.message ?? "Done." : r?.message ?? "Cancelled.";
      setDone(decision === "approve" ? "Approved" : "Declined");
      onDecided(typeof text === "string" ? text : JSON.stringify(text));
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(""); }
  };
  const summary = approval.summary ? Object.entries(approval.summary).filter(([, v]) => v !== undefined && v !== null && v !== "").slice(0, 6) : [];
  return (
    <div className={`card approval ${done ? "decided" : ""}`}>
      <div className="card-head"><span className="kicker warn">Needs your OK</span>{approval.risk ? <span className="risk">{approval.risk}</span> : null}</div>
      <div className="card-title mono">{approval.tool}</div>
      {summary.length ? <dl className="kv">{summary.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{typeof v === "string" ? v : JSON.stringify(v)}</dd></div>)}</dl> : null}
      {done ? <div className="card-body muted">{done}</div> : (
        <div className="btn-row">
          <button type="button" className="btn" disabled={!!busy} onClick={() => void decide("deny")}>{busy === "deny" ? "…" : "Decline"}</button>
          <button type="button" className="btn primary" disabled={!!busy} onClick={() => void decide("approve")}>{busy === "approve" ? "…" : "Approve"}</button>
        </div>
      )}
      {err ? <div className="err">{err}</div> : null}
    </div>
  );
}

function ModelTurn({ t, onSend, onFollowup }: { t: Turn; onSend: (s: string) => void; onFollowup: (s: string) => void }) {
  const r = t.result;
  const uiActions = t.uiActions || r?.uiActions || [];
  const stage = uiActions.filter((a) => a.type === "stage-render");
  const pc = uiActions.filter((a) => a.type && a.type !== "stage-render").map((a) => (a.id ? `${a.type.replace(/-/g, " ")} · ${a.id}` : a.type.replace(/-/g, " ")));
  const lastEv = t.activity?.length ? t.activity[t.activity.length - 1] : null;
  const stamp = !t.streaming ? [r?.model, r?.timing?.totalMs ? `${(r.timing.totalMs / 1000).toFixed(1)}s` : "", typeof r?.usage?.costUsd === "number" ? `$${r.usage.costUsd.toFixed(3)}` : "", fmtTime(t.at)].filter(Boolean).join(" · ") : "";
  return (
    <div className={`turn model ${t.streaming ? "live" : ""}`}>
      <div className="rail"><i className={`dot ${t.error ? "bad" : t.streaming ? "live" : "ok"}`} /></div>
      <div className="main">
        {t.streaming && !t.text ? <div className="thinking"><span>{t.phase || lastEv?.label || "Working"}{lastEv?.detail && !t.phase ? <span className="dim"> — {lastEv.detail}</span> : null}</span><span className="bar"><i /></span></div> : null}
        {stage.map((a, i) => <StageCard key={`s${i}`} action={a} />)}
        {r?.sources?.length ? <Sources sources={r.sources} /> : null}
        {t.text ? <div className="prose"><JarvisMarkdown text={t.text} /></div> : null}
        {t.error ? <div className="err">{t.error}</div> : null}
        {r?.cards?.map((c, i) => <ResultCard key={`c${i}`} card={c} onSend={onSend} />)}
        {r?.artifacts?.map((a, i) => <Artifact key={`a${i}`} a={a} />)}
        {r?.pendingConfirmations?.map((p) => <ApprovalCard key={p.id} approval={p} onDecided={onFollowup} />)}
        {pc.length ? <div className="pc-note">On the PC: {pc.join(", ")}</div> : null}
        {stamp ? <div className="stamp">{stamp}</div> : null}
      </div>
    </div>
  );
}

export function Thread({ turns, onSend, onFollowup }: { turns: Turn[]; onSend: (t: string) => void; onFollowup: (t: string) => void }) {
  const end = useRef<HTMLDivElement>(null);
  const lastLen = useRef(0);
  useEffect(() => {
    const el = end.current; if (!el) return;
    const sc = el.closest(".scroll"); if (!sc) return;
    const nearBottom = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 220;
    const grew = turns.length !== lastLen.current; lastLen.current = turns.length;
    // scroll the container itself: the dock is sticky INSIDE it, so scrollIntoView on the end marker
    // would leave the last turn hidden under the composer
    if (grew || nearBottom) sc.scrollTop = sc.scrollHeight;
  }, [turns]);
  return (
    <div className="thread">
      {turns.map((t) => t.role === "user" ? (
        <div key={t.id} className="turn user">
          <div className="bubble">
            {t.image ? <img className="bubble-img" src={t.image} alt="" /> : null}
            {t.files?.length ? <div className="bubble-files">{t.files.map((f) => <span key={f} className="chip">{f}</span>)}</div> : null}
            {t.text ? <div className="bubble-text">{t.text}</div> : null}
          </div>
          <div className="stamp right">{fmtTime(t.at)}</div>
        </div>
      ) : <ModelTurn key={t.id} t={t} onSend={onSend} onFollowup={onFollowup} />)}
      <div ref={end} className="thread-end" />
    </div>
  );
}

export async function pendingApprovals(): Promise<Approval[]> {
  try { const r = await api<{ confirmations?: Approval[] }>("/api/confirmations/pending"); return r.confirmations || []; } catch { return []; }
}
