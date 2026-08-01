"use strict";

const { createTaskRepository } = require("./repositories/task-repository");
const { createConversationStateKernel } = require("./conversation-state-kernel");

function createTaskRuntime({ store } = {}) {
  if (!store?.attachRepository) throw new Error("A Memory vNext core store is required.");
  const repository = store.attachRepository(createTaskRepository);
  const kernel = createConversationStateKernel({ store });

  function project(task, sourceTurnId) {
    if (!task.conversationId || !task.branchId || !sourceTurnId) return null;
    const state = kernel.initialize(task.conversationId, task.branchId);
    return kernel.applyDelta({ conversationId: task.conversationId, branchId: task.branchId, sourceTurnId, expectedSequence: state.stateSequence, operations: [{
      type: "put_slot", namespace: "task", key: "active-task", slotType: "working", sensitivity: "private",
      value: { taskId: task.id, objective: task.objective, status: task.status, currentStepId: task.currentStepId,
        completedStepIds: task.steps.filter((step) => step.status === "completed").map((step) => step.id),
        readyStepIds: task.steps.filter((step) => step.status === "ready").map((step) => step.id) },
    }] });
  }

  function createTask(input) { const task = repository.createTask(input); project(task, input.sourceTurnId); return task; }
  function startStep(input) { const task = repository.startStep(input.taskId, input.stepId); project(task, input.sourceTurnId); return task; }
  function completeStep(input) { const task = repository.completeStep(input.taskId, input.stepId, input.result); project(task, input.sourceTurnId); return task; }

  return Object.freeze({ ...repository, createTask, startStep, completeStep, repository });
}

module.exports = { createTaskRuntime };
