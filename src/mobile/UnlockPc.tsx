import React, { useCallback, useEffect, useState } from "react";
import { startRegistration, startAuthentication } from "@simplewebauthn/browser";
import { api, post } from "../api";

// "Unlock laptop" — step 1. The phone proves it's the owner with Face ID (WebAuthn platform
// authenticator); on success the server raises a short-lived approval flag. The lock screen itself
// is unlocked by the Credential Provider in step 2 (not built yet), so here we honestly say the
// approval was raised rather than claiming the PC unlocked.

type State = { enrolled: boolean; count: number; pending: boolean; expiresInMs: number; lastApprovedAt: number | null };

const I = {
  lock: <svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></svg>,
  face: <svg viewBox="0 0 24 24"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" /><path d="M9 10v1M15 10v1M9.5 15c.8.7 4.2.7 5 0" /></svg>,
  check: <svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>,
};

export function UnlockPc() {
  const [st, setSt] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const refresh = useCallback(async () => {
    try { setSt(await api<State>("/api/device-mesh/unlock/state")); } catch { /* offline */ }
  }, []);
  useEffect(() => { void refresh(); const t = window.setInterval(refresh, 5000); return () => window.clearInterval(t); }, [refresh]);

  const enroll = useCallback(async () => {
    setBusy(true); setErr(""); setMsg("");
    try {
      const { challengeId, options } = await post<{ challengeId: string; options: any }>("/api/device-mesh/unlock/enroll/options", {});
      const response = await startRegistration({ optionsJSON: options });
      const r = await post<{ enrolled: boolean }>("/api/device-mesh/unlock/enroll/verify", { challengeId, response });
      if (r.enrolled) setMsg("Face ID set up for unlock.");
      await refresh();
    } catch (e: any) {
      setErr(e?.name === "NotAllowedError" ? "Face ID cancelled." : e?.message || "Enrollment failed.");
    } finally { setBusy(false); }
  }, [refresh]);

  const unlock = useCallback(async () => {
    setBusy(true); setErr(""); setMsg("");
    try {
      const { challengeId, options } = await post<{ challengeId: string; options: any }>("/api/device-mesh/unlock/auth/options", {});
      const response = await startAuthentication({ optionsJSON: options });
      const r = await post<{ approved: boolean; expiresInMs: number }>("/api/device-mesh/unlock/auth/verify", { challengeId, response });
      if (r.approved) setMsg(`Face ID matched — unlock approved (${Math.round(r.expiresInMs / 1000)}s). Lock-screen step comes next.`);
      await refresh();
    } catch (e: any) {
      setErr(e?.name === "NotAllowedError" ? "Face ID cancelled or failed." : e?.message || "Unlock failed.");
    } finally { setBusy(false); }
  }, [refresh]);

  const enrolled = st?.enrolled;
  return (
    <div className={`unlock ${st?.pending ? "on" : ""}`}>
      <span className="unlock-ico">{st?.pending ? I.check : I.lock}</span>
      <div className="unlock-t">
        <b>{st?.pending ? "Unlock approved" : "Unlock laptop"}</b>
        <small>{err ? err : msg ? msg : enrolled ? "Face ID · this phone is set up" : "Set up Face ID to unlock the PC"}</small>
      </div>
      {enrolled
        ? <button type="button" className="unlock-go" disabled={busy} onClick={() => void unlock()}>{I.face}<span>{busy ? "…" : "Face ID"}</span></button>
        : <button type="button" className="unlock-go" disabled={busy} onClick={() => void enroll()}>{busy ? "…" : "Set up"}</button>}
    </div>
  );
}
