"use strict";

const contracts = require("./contracts");
const { handleMemoryV1Request } = require("./http-handler");
const { createLegacyMemoryAdapters } = require("./legacy-adapters");
const { createMemoryService } = require("./service");
const { openCoreStore } = require("./storage/core-store");
const { createWindowsDpapiProtector } = require("./storage/dpapi-protector");
const { defaultMemoryVNextRoot } = require("./storage/paths");
const { createMemorySupervisor } = require("./supervisor");
const { createPolicyEngine } = require("./policy-engine");
const { createKeyHierarchy } = require("./key-hierarchy");
const { createMemoryObservability } = require("./observability");
const { createConversationJournal } = require("./conversation-journal");
const { createConversationStateKernel } = require("./conversation-state-kernel");
const { createTaskRuntime } = require("./task-runtime");
const { createSemanticSegmenter } = require("./semantic-segmenter");
const { createKnowledgeService } = require("./knowledge-service");
const { createAssertionService } = require("./assertion-service");
const { createPersonalMemoryService } = require("./personal-memory-service");
const { createTruthMaintenance } = require("./truth-maintenance");
const { createRetrievalOracle } = require("./retrieval-oracle");
const { createCacheFabric } = require("./cache-fabric");
const { createEmbeddingGateway } = require("./embedding-gateway");
const { createRetrievalPlanner } = require("./retrieval-planner");
const { createContextRuntime } = require("./context-runtime");
const { createTemporalGraph } = require("./temporal-graph");
const { createConsolidationLab } = require("./consolidation-lab");
const { createArtifactRegistry } = require("./artifact-registry");
const { createMultimodalArtifacts } = require("./multimodal-artifacts");
const { createExperienceLearning } = require("./experience-learning");
const { createRoomManifests } = require("./room-manifests");
const { createHelixIntegration } = require("./helix-integration");
const { createApexForgeIntegration } = require("./apex-forge-integration");
const { createEclipseMemoryIntegration } = require("./eclipse-integration");
const { createMeshMemorySync } = require("./mesh-sync");
const { createMemoryOperations } = require("./operations");
const { createMemoryMigration } = require("./migration-import");
const { createMemoryShadowEvaluation } = require("./shadow-evaluation");
const { createMemoryCutoverCoordinator } = require("./cutover-coordinator");
const { createCandidateProjector } = require("./candidate-projector");
const { createPersonalContextRouter } = require("./personal-context-router");
const { createMemoryVNextShadowRuntime } = require("./shadow-runtime");
const { createAuthorityResolver } = require("./authority-resolver");

function createMemoryVNextBoundary({ memoryStore, neuralVault, authorize, clock, telemetry, authorityProvider } = {}) {
  return createMemoryService({
    adapters: createLegacyMemoryAdapters({ memoryStore, neuralVault }),
    authorize,
    clock,
    telemetry,
    // Supplied by server.js from the shadow runtime, so the boundary reports the SAME
    // authority the answer path acts on. Omitted -> legacy, exactly as before.
    authorityProvider,
  });
}

module.exports = {
  ...contracts,
  createLegacyMemoryAdapters,
  createMemoryService,
  createMemorySupervisor,
  createPolicyEngine,
  createKeyHierarchy,
  createMemoryObservability,
  createConversationJournal,
  createConversationStateKernel,
  createTaskRuntime,
  createSemanticSegmenter,
  createKnowledgeService,
  createAssertionService,
  createPersonalMemoryService,
  createTruthMaintenance,
  createRetrievalOracle,
  createCacheFabric,
  createEmbeddingGateway,
  createRetrievalPlanner,
  createContextRuntime,
  createTemporalGraph,
  createConsolidationLab,
  createArtifactRegistry,
  createMultimodalArtifacts,
  createExperienceLearning,
  createRoomManifests,
  createHelixIntegration,
  createApexForgeIntegration,
  createEclipseMemoryIntegration,
  createMeshMemorySync,
  createMemoryOperations,
  createMemoryMigration,
  createMemoryShadowEvaluation,
  createMemoryCutoverCoordinator,
  createCandidateProjector,
  createPersonalContextRouter,
  createMemoryVNextShadowRuntime,
  createMemoryVNextBoundary,
  createAuthorityResolver,
  createWindowsDpapiProtector,
  defaultMemoryVNextRoot,
  handleMemoryV1Request,
  openCoreStore,
};
