"use strict";

const { createSemanticSegmentationRepository } = require("./repositories/semantic-segmentation-repository");

function createSemanticSegmenter({ store, ambiguousClassifier, profileId, profileVersion, classifierName, classifierVersion } = {}) {
  if (!store?.attachRepository) throw new Error("A Memory vNext core store is required.");
  return store.attachRepository((dependencies) => createSemanticSegmentationRepository(dependencies, { ambiguousClassifier, profileId, profileVersion, classifierName, classifierVersion }));
}

module.exports = { createSemanticSegmenter };
