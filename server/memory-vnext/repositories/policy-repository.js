"use strict";

const crypto = require("node:crypto");

function createPolicyRepository({ db, clock }) {
  if (Number(db.pragma("user_version", { simple: true })) < 3) throw new Error("Policy repository requires schema version 3.");

  function upsertActor(input = {}) {
    const now = clock().toISOString();
    const id = String(input.id || "");
    if (!id) throw new Error("Actor id is required.");
    db.prepare(`INSERT INTO actors(id,actor_type,owner_id,status,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET actor_type=excluded.actor_type,owner_id=excluded.owner_id,status=excluded.status,
      metadata_json=excluded.metadata_json,updated_at=excluded.updated_at`)
      .run(id, String(input.actorType || "agent"), input.ownerId ? String(input.ownerId) : null,
        String(input.status || "active"), JSON.stringify(input.metadata || {}), now, now);
    return getActor(id);
  }

  function getActor(id) { return db.prepare("SELECT id,actor_type,owner_id,status,metadata_json,created_at,updated_at FROM actors WHERE id=?").get(String(id)) || null; }

  function createScope(input = {}) {
    const now = clock().toISOString();
    const id = String(input.id || "");
    if (!id) throw new Error("Scope id is required.");
    db.prepare("INSERT INTO scopes(id,scope_type,name,owner_actor_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
      .run(id, String(input.scopeType || "project"), String(input.name || id), String(input.ownerActorId || "local-owner"),
        String(input.status || "active"), now, now);
    if (input.parentScopeId) addScopeEdge({ parentScopeId: input.parentScopeId, childScopeId: id, relation: "contains" });
    return getScope(id);
  }

  function getScope(id) { return db.prepare("SELECT * FROM scopes WHERE id=?").get(String(id)) || null; }

  function scopeContains(parentScopeId, childScopeId) {
    if (parentScopeId === childScopeId) return true;
    return Boolean(db.prepare(`WITH RECURSIVE descendants(id) AS (
      SELECT child_scope_id FROM scope_edges WHERE parent_scope_id=? AND relation='contains'
      UNION SELECT e.child_scope_id FROM scope_edges e JOIN descendants d ON e.parent_scope_id=d.id WHERE e.relation='contains'
    ) SELECT 1 AS found FROM descendants WHERE id=? LIMIT 1`).get(parentScopeId, childScopeId));
  }

  function addScopeEdge(input = {}) {
    const parent = String(input.parentScopeId || "");
    const child = String(input.childScopeId || "");
    const relation = String(input.relation || "contains");
    if (!getScope(parent) || !getScope(child)) throw new Error("Both scope-edge endpoints must exist.");
    if (parent === child || (relation === "contains" && scopeContains(child, parent))) throw new Error("Scope edge would create a containment cycle.");
    db.prepare("INSERT INTO scope_edges(parent_scope_id,child_scope_id,relation,policy_id,created_at) VALUES(?,?,?,?,?)")
      .run(parent, child, relation, input.policyId ? String(input.policyId) : null, clock().toISOString());
    return { parentScopeId: parent, childScopeId: child, relation };
  }

  function createPolicy(input = {}) {
    const id = String(input.id || crypto.randomUUID());
    const version = Number(input.version || 1);
    db.prepare(`INSERT INTO policies(id,version,kind,expression_json,effect,status,created_by,created_at)
      VALUES(?,?,?,?,?,?,?,?)`)
      .run(id, version, String(input.kind), JSON.stringify(input.expression || {}), String(input.effect || "deny"),
        String(input.status || "active"), String(input.createdBy || "local-owner"), clock().toISOString());
    return { id, version };
  }

  function issueGrant(input = {}) {
    const issuedAt = clock();
    const expiresAt = new Date(input.expiresAt);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= issuedAt) throw new Error("Grant expiry must be in the future.");
    const id = String(input.id || crypto.randomUUID());
    db.prepare(`INSERT INTO grants
      (id,actor_id,capability,resource_pattern,purpose_pattern,effect,max_sensitivity,cloud_allowed,share_allowed,issued_by,
       issued_at,expires_at,revoked_at,origin_type,origin_id,metadata_json)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?)`)
      .run(id, String(input.actorId), String(input.capability), String(input.resourcePattern), String(input.purposePattern),
        String(input.effect || "allow"), String(input.maxSensitivity || "private"), input.cloudAllowed === true ? 1 : 0,
        input.shareAllowed === true ? 1 : 0, String(input.issuedBy || "local-owner"), issuedAt.toISOString(), expiresAt.toISOString(),
        String(input.originType || "owner"), input.originId ? String(input.originId) : null, JSON.stringify(input.metadata || {}));
    return publicGrant(db.prepare("SELECT * FROM grants WHERE id=?").get(id));
  }

  function publicGrant(row) {
    if (!row) return null;
    return {
      id: row.id, actorId: row.actor_id, capability: row.capability, resourcePattern: row.resource_pattern,
      purposePattern: row.purpose_pattern, effect: row.effect, maxSensitivity: row.max_sensitivity,
      cloudAllowed: row.cloud_allowed === 1, shareAllowed: row.share_allowed === 1, issuedBy: row.issued_by,
      issuedAt: row.issued_at, expiresAt: row.expires_at, revokedAt: row.revoked_at,
      originType: row.origin_type, originId: row.origin_id,
    };
  }

  function activeGrants(actorId, capability) {
    return db.prepare(`SELECT * FROM grants WHERE actor_id=? AND capability IN (?, '*') AND revoked_at IS NULL AND expires_at>?
      ORDER BY CASE effect WHEN 'deny' THEN 0 ELSE 1 END,expires_at`).all(String(actorId), String(capability), clock().toISOString()).map(publicGrant);
  }

  function revokeGrant(id) {
    const changed = db.prepare("UPDATE grants SET revoked_at=? WHERE id=? AND revoked_at IS NULL").run(clock().toISOString(), String(id));
    return { id: String(id), revoked: changed.changes === 1 };
  }

  function recordDenial(input = {}) {
    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO policy_denials(id,actor_id,capability,scope_id,purpose,sensitivity,reason_code,policy_id,correlation_id,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(id, String(input.actorId || "unknown"), String(input.capability || "unknown"), String(input.scopeId || "unknown"),
        String(input.purpose || "unknown"), String(input.sensitivity || "private"), String(input.reasonCode || "POLICY_DENIED"),
        input.policyId ? String(input.policyId) : null, input.correlationId ? String(input.correlationId) : null, clock().toISOString());
    return { id };
  }

  function putRetentionPolicy(input = {}) {
    const now = clock().toISOString();
    db.prepare(`INSERT INTO retention_policies(id,name,retain_days,raw_content_days,deletion_mode,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,retain_days=excluded.retain_days,
      raw_content_days=excluded.raw_content_days,deletion_mode=excluded.deletion_mode,updated_at=excluded.updated_at`)
      .run(String(input.id), String(input.name), input.retainDays == null ? null : Number(input.retainDays),
        input.rawContentDays == null ? null : Number(input.rawContentDays), String(input.deletionMode || "review"), now, now);
    return db.prepare("SELECT * FROM retention_policies WHERE id=?").get(String(input.id));
  }

  function health() {
    return {
      actors: Number(db.prepare("SELECT COUNT(*) AS count FROM actors WHERE status='active'").get().count),
      scopes: Number(db.prepare("SELECT COUNT(*) AS count FROM scopes WHERE status='active'").get().count),
      activeGrants: Number(db.prepare("SELECT COUNT(*) AS count FROM grants WHERE revoked_at IS NULL AND expires_at>?").get(clock().toISOString()).count),
      denials: Number(db.prepare("SELECT COUNT(*) AS count FROM policy_denials").get().count),
      policies: Number(db.prepare("SELECT COUNT(*) AS count FROM policies WHERE status='active'").get().count),
    };
  }

  return Object.freeze({ activeGrants, addScopeEdge, createPolicy, createScope, getActor, getScope, health, issueGrant, putRetentionPolicy, recordDenial, revokeGrant, scopeContains, upsertActor });
}

module.exports = { createPolicyRepository };
