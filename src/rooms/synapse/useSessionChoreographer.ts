import { useMemo } from "react";

// Synapse W5 — the "Choreographer" (Session-UX agent) as a deterministic rule engine (§3.3).
// Zero side effects of its own: it turns live presence + session state into narration lines,
// actionable suggestion chips, and a layout spotlight. The room renders them; the user clicks.
// (Optional LLM phrasing is a later refinement — the default rule engine costs nothing.)

export type ChoreoEvent = { kind: string; who?: { name?: string; role?: string }; detail?: string; at: number };
export type SuggestionKind = "approve" | "review-patch" | "share" | "debate" | "call";
export type Suggestion = { id: string; label: string; kind: SuggestionKind };

function narrate(e: ChoreoEvent): string {
  const who = e.who?.name || "A peer";
  switch (e.kind) {
    case "peer-join": return `${who} connected.`;
    case "peer-leave": return `${who} left.`;
    case "chat": return `${who} sent a message.`;
    case "patch": return "A patch was proposed — Patch Court is live.";
    case "debate": return "Jarvis debate is running.";
    case "join-request": return `${who} wants to join.`;
    case "screen": return `${who} started sharing their screen.`;
    default: return "";
  }
}

export function useSessionChoreographer(
  { session, livePeers, events, callActive = false }:
  { session: any; livePeers: Array<{ role: string; name: string }>; events: ChoreoEvent[]; callActive?: boolean },
) {
  // Narration: last few distinct events, batched so a burst reads as one calm line.
  const narration = useMemo(() => {
    const lines = events.slice(-8).map(narrate).filter(Boolean);
    const deduped = lines.filter((l, i) => l !== lines[i - 1]);
    if (deduped.length > 4) return [`${deduped.length} updates just now`, ...deduped.slice(-2)];
    return deduped.slice(-3);
  }, [events]);

  // Suggestions: contextual, one-click. Proposed, not executed.
  const suggestions = useMemo<Suggestion[]>(() => {
    const out: Suggestion[] = [];
    if (!session) return out;
    if (session.pendingJoin) out.push({ id: "approve", label: `Approve ${session.pendingJoin.displayName}?`, kind: "approve" });
    const patch = (session.patches || []).find((p: any) => p.status === "proposed" || p.status === "ghost_passed");
    if (patch) out.push({ id: `review-${patch.id}`, label: "Review the pending patch", kind: "review-patch" });
    if (session.status === "active" && !session.guest && !session.pendingJoin) out.push({ id: "share", label: "Share the invite to bring a collaborator", kind: "share" });
    if (session.status === "active" && (session.jarvisMessages || []).length === 0) out.push({ id: "debate", label: "Run a Jarvis debate on the next step", kind: "debate" });
    if (session.status === "active" && session.guest && !callActive) out.push({ id: "call", label: "Start a call (W6)", kind: "call" });
    return out.slice(0, 4);
  }, [session, callActive]);

  // Layout spotlight — which surface the room should emphasise right now.
  const spotlight = useMemo<"workspace" | "debate" | "call">(() => {
    if (callActive) return "call";
    if ((session?.jarvisMessages || []).length > 0) return "debate";
    return "workspace";
  }, [session, callActive]);

  return { narration, suggestions, spotlight, peerCount: livePeers.length };
}
