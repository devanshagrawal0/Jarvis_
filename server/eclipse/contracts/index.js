// ECLIPSE contracts barrel. `require("./contracts")` → all schemas + validation helpers.
const schemas = require("./schemas");
const validate = require("./validate");

// Registry of persisted schema versions (for migration/version checks).
const SCHEMA_VERSIONS = Object.freeze({
  mission: "eclipse.mission.v1",
  genome: "eclipse.genome.v1",
  plan: "eclipse.plan.v1",
  state: "eclipse.state.v1",
  packet: "eclipse.packet.v1",
  lease: "eclipse.lease.v1",
  blueprint: "eclipse.blueprint.v1",
  artifact: "eclipse.artifact.v1",
  capsule: "eclipse.capsule.v1",
  event: "eclipse.event.v1",
});

module.exports = { ...schemas, ...validate, SCHEMA_VERSIONS };
