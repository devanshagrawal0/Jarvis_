export function slugifyTaskName(value: string, fallback = "task"): string {
  return (value || fallback)
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || fallback;
}

export function genericCandidateSlug(domain: string, object: string, action: string): string {
  return slugifyTaskName(`${domain}-${object}-${action}`);
}

export function assertGoodJarvisSlug(slug: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+){2,}$/.test(slug)) throw new Error(`Bad Jarvis candidate slug: ${slug}`);
  if (["new-skill", "skill1", "youtube-test", "temp-action", "do-task", "automation", "misc"].includes(slug)) {
    throw new Error(`Overfit or vague Jarvis slug rejected: ${slug}`);
  }
}
