"use strict";
const { createExperienceLearningRepository } = require("./repositories/experience-learning-repository");
function createExperienceLearning({ store } = {}) { if (!store?.attachRepository) throw new Error("A Memory vNext core store is required."); return store.attachRepository(createExperienceLearningRepository); }
module.exports = { createExperienceLearning };
