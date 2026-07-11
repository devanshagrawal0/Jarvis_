import type { GeneratedTaskCandidate, TempTaskLog } from "./CandidateTypes";
import { extractGenericTaskParameters } from "./TaskParameterExtractor";
import { assertGoodJarvisSlug, genericCandidateSlug } from "../protocols/NamingProtocol";

export function planGenericTaskCandidate(task: TempTaskLog): GeneratedTaskCandidate {
  const domain = task.domains[0] || "other";
  const action = task.reusablePotential === "command" ? "run" : task.filesAccessed.length ? "inspect" : task.websitesUsed.length ? "search" : "execute";
  const object = task.filesAccessed.length ? "file" : task.websitesUsed.length ? "site" : "task";
  const slug = genericCandidateSlug(domain, object, action);
  assertGoodJarvisSlug(slug);
  return {
    id: `candidate.${slug}`,
    candidateType: task.reusablePotential === "none" || task.reusablePotential === "note" ? "memory_object" : task.reusablePotential,
    slug,
    name: slug.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join(" "),
    sourceTaskId: task.id,
    projectId: task.projectId || "jarvis",
    domain,
    parameters: task.parameterCandidates.length ? task.parameterCandidates : extractGenericTaskParameters(task),
    triggers: [task.originalUserRequest, `${slug} with {input}`].filter(Boolean),
    status: "candidate",
    memoryUri: `memory://projects/${task.projectId || "jarvis"}/${task.reusablePotential}s/${slug}`,
  };
}
