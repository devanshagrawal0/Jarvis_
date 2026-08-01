"use strict";

const { createRoomManifestRepository } = require("./room-manifest-repository");

const HELIX_REF_GROUPS = Object.freeze({ projects: "project", folders: "folder", segments: "segment", questions: "question", plans: "plan", runs: "run", sources: "source", evidence: "evidence", claims: "claim", decisions: "decision", artifacts: "artifact", tasks: "task", operations: "operation" });
function refsFrom(input) { const refs = []; for (const [field, kind] of Object.entries(HELIX_REF_GROUPS)) for (const item of input[field] || []) refs.push({ ...item, kind, domainOwner: "helix" }); return refs; }

function createHelixIntegrationRepository(dependencies) {
  const rooms = createRoomManifestRepository(dependencies);
  function publishResearchSnapshot(input = {}) { const exclusions = [...(input.internalModelCalls || []).map((item) => ({ domainRef: String(item.id), kind: "internal_model", reasonCode: "HELIX_INTERNAL_CALL_NOT_GLOBAL_CONVERSATION" })), ...(input.telemetryRefs || []).map((item) => ({ domainRef: String(item.id), kind: "telemetry", reasonCode: "HELIX_TELEMETRY_DOMAIN_OWNED" }))]; return rooms.publish({ ...input, room: "helix", refs: refsFrom(input), exclusions }); }
  function currentProject(input = {}) { return rooms.current({ room: "helix", projectId: input.projectId, allowedScopeIds: input.allowedScopeIds }); }
  function explainLineage(input = {}) { return rooms.lineage(input); }
  return Object.freeze({ currentProject, explainLineage, publishResearchSnapshot });
}

module.exports = { HELIX_REF_GROUPS, createHelixIntegrationRepository };
