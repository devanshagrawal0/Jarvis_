import type { TaskParameterCandidate, TaskStep } from "./CandidateTypes";

export function extractGenericTaskParameters(input: {
  originalUserRequest?: string;
  filesAccessed?: string[];
  websitesUsed?: string[];
  steps?: Partial<TaskStep>[];
}): TaskParameterCandidate[] {
  const params: TaskParameterCandidate[] = [];
  const add = (name: string, value: string, inferredType: TaskParameterCandidate["inferredType"], sourceStepIndex?: number, privacy: TaskParameterCandidate["privacy"] = "safe") => {
    if (!value) return;
    if (/(api[_-]?key|token|password|secret|AIza|sk-)/i.test(value)) {
      params.push({ name, value: "[secret_blocked]", inferredType, sourceStepIndex, generalizable: false, exampleValues: [], privacy: "secret_blocked" });
      return;
    }
    if (!params.some((param) => param.name === name && param.value === value)) {
      params.push({ name, value, inferredType, sourceStepIndex, generalizable: true, exampleValues: [value], privacy });
    }
  };
  input.websitesUsed?.forEach((value) => add("site_url", value, "url"));
  input.filesAccessed?.forEach((value) => add("file_path", value, "file_path", undefined, "private"));
  input.steps?.forEach((step, index) => {
    if (step.url) add("url", step.url, "url", index);
    if (step.selector) add("selector", step.selector, "selector", index);
    if (step.text) add(step.actionType === "type" ? "text" : "query", step.text, "query", index);
  });
  for (const match of String(input.originalUserRequest || "").matchAll(/\bhttps?:\/\/[^\s)]+/g)) add("url", match[0], "url");
  return params;
}
