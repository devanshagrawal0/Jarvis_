# Wave 27 Evidence Report - Eclipse Mission Memory

Date: 2026-07-26  
Result: Complete in isolated implementation/test mode  
Production activation: No  
Paid provider calls: 0

## Delivered

- Versioned Eclipse mission publications for missions, branches, nodes, claims, evidence, artifacts, agents, tasks, operations, and agent outcomes.
- Current objective, summary, status, warnings, open loops, costs, exclusions, and lineage through the common room contract.
- Per-reference owner, mission, agent-private, or quarantined visibility.
- Required capability, subject, lease, trust zone, and expiry metadata.
- Package filtering that requires every package member to be recall-visible.
- Explicit exclusions for reasoning traces, private agent state, and telemetry.
- Evidence-backed success/failure links to Wave 24 verifications and experience cases.
- Signed agent-experience receipts with `promotable=false`.

## Verified

- Owner recall sees trusted owner references only.
- Mission recall sees only its mission references.
- Agent-private state is visible only to the matching agent.
- Quarantined claims require both the quarantine capability and explicit inclusion.
- Untrusted state cannot publish as owner-wide recall.
- Raw reasoning fields fail before manifest persistence.
- Agent outcomes require scope-matched verification and case lineage.
- Successful and failed agent outcomes remain non-promotable records.
- Private mission summary text is absent from raw SQLite bytes.
- Controlled Eclipse faults roll back the room manifest, encrypted payloads, and policies together.

## Deliberate boundary

The live Eclipse runtime does not yet publish to this integration. No mission was launched, no Gemini call ran, and no existing Eclipse database was modified or copied. Wave 27 supplies the governed memory contract for later cutover.
