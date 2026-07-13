// Team (H14). Honest local collaboration: real member profiles + roles, and a live
// review queue on decisions. No fake avatars — every row is a stored record; roles are
// managed by the owner (this is a personal tool, so "users" are local profiles).
import React, { useEffect, useState } from "react";
import { Ico } from "../hxIcons";

interface Member { id: string; name: string; email?: string; role: string; avatar_seed?: string; }
interface Review { id: string; decision_id: string; member_id: string; status: string; requested_at: string; }

const ROLE_TONE: Record<string, string> = { owner: "good", reviewer: "", contributor: "warn", viewer: "" };

export function Team({ projectId }: { projectId?: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [name, setName] = useState("");
  const [role, setRole] = useState("reviewer");

  const load = () => {
    fetch("/api/helix/members").then(r => r.json()).then(d => setMembers(d.members || [])).catch(() => {});
    if (projectId) fetch(`/api/helix/reviews?projectId=${projectId}`).then(r => r.json()).then(d => setReviews(d.reviews || [])).catch(() => {});
  };
  useEffect(load, [projectId]);

  const addMember = async () => {
    if (!name.trim()) return;
    await fetch("/api/helix/members", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), role }) });
    setName(""); load();
  };
  const removeMember = async (id: string) => { await fetch(`/api/helix/members/${id}`, { method: "DELETE" }); load(); };
  const resolve = async (reviewId: string, status: string) => {
    await fetch(`/api/helix/review/${reviewId}/resolve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    load();
  };
  const memberName = (id: string) => members.find(m => m.id === id)?.name || id.slice(0, 8);
  const pending = reviews.filter(r => r.status === "pending");

  return (
    <div className="hxv-surface">
      <div className="hxv-surface-head">
        <div><div className="hxv-h1">Team</div><div className="hxv-h1-sub">Local collaborators, roles, and the decision-review queue.</div></div>
      </div>

      <div className="hxv-cols">
        {/* Members */}
        <div className="hxv-panel">
          <div className="hxv-panel-h"><span className="hxv-u">Members · {members.length}</span></div>
          <div style={{ display: "flex", gap: 8, padding: "10px 14px", borderBottom: "1px solid var(--v-line)" }}>
            <input className="hxv-dec-input" style={{ flex: 1 }} placeholder="Add member name…" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && addMember()} />
            <select className="hxv-dec-input" style={{ width: 120 }} value={role} onChange={e => setRole(e.target.value)}>
              {["owner", "reviewer", "contributor", "viewer"].map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <button className="hxv-btn solid" onClick={addMember}>Add</button>
          </div>
          <div>
            {members.length === 0 && <div style={{ padding: 16, fontSize: 12, color: "var(--v-text3)" }}>No collaborators yet — add one above.</div>}
            {members.map(m => (
              <div className="hxv-mrow" key={m.id} style={{ padding: "10px 14px" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="hxv-ava" style={{ width: 26, height: 26, fontSize: 10 }}>{m.avatar_seed || m.name.slice(0, 2).toUpperCase()}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 500 }}>{m.name}</span>
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className={"hxv-tag " + (ROLE_TONE[m.role] || "")}>{m.role}</span>
                  <span className="hxv-nav-ico" style={{ cursor: "pointer", color: "var(--v-text3)" }} onClick={() => removeMember(m.id)}><Ico.x /></span>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Review queue */}
        <div className="hxv-panel">
          <div className="hxv-panel-h"><span className="hxv-u">Review queue · {pending.length} pending</span></div>
          <div>
            {reviews.length === 0 && <div style={{ padding: 16, fontSize: 12, color: "var(--v-text3)" }}>No reviews requested. Assign a reviewer to a decision in Analyze.</div>}
            {reviews.map(rv => (
              <div className="hxv-mrow" key={rv.id} style={{ padding: "11px 14px" }}>
                <div>
                  <div style={{ fontSize: 12.5 }}>Decision {rv.decision_id.slice(0, 8)} → {memberName(rv.member_id)}</div>
                  <div style={{ fontSize: 10.5, color: "var(--v-text3)" }}>{rv.requested_at?.slice(0, 16).replace("T", " ")}</div>
                </div>
                {rv.status === "pending" ? (
                  <span style={{ display: "flex", gap: 6 }}>
                    <button className="hxv-btn ghost" style={{ padding: "5px 10px" }} onClick={() => resolve(rv.id, "rejected")}>Reject</button>
                    <button className="hxv-btn" style={{ padding: "5px 10px" }} onClick={() => resolve(rv.id, "approved")}>Approve</button>
                  </span>
                ) : <span className={"hxv-tag " + (rv.status === "approved" ? "good" : "bad")}>{rv.status}</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
